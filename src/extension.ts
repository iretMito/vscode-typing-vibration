import * as vscode from "vscode";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import WebSocket, { WebSocketServer } from "ws";

let httpServer: http.Server | undefined;
let wss: WebSocketServer | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let textChangeDisposable: vscode.Disposable | undefined;
let activePort: number | undefined;
let isShaking = false;

// Intensity mapping table: [rightOffset, leftOffset, stepDuration]
const SHAKE_INTENSITY_TABLE: Record<number, [number, number, number]> = {
  1: [2, -1, 20],
  2: [3, -1, 25],
  3: [4, -2, 30],
  4: [6, -3, 35],
  5: [8, -4, 40],
};

let shakeRightDecor: vscode.TextEditorDecorationType;
let shakeLeftDecor: vscode.TextEditorDecorationType;
let shakeEnabled = true;
let shakeIntensity = 3;
let serverEnabled = true;

function getConfig() {
  const config = vscode.workspace.getConfiguration("vibeCoding");
  shakeEnabled = config.get<boolean>("editorShake.enabled", true);
  shakeIntensity = config.get<number>("editorShake.intensity", 3);
  if (shakeIntensity < 1) shakeIntensity = 1;
  if (shakeIntensity > 5) shakeIntensity = 5;
  serverEnabled = config.get<boolean>("server.enabled", true);
}

function createShakeDecorations() {
  if (shakeRightDecor) shakeRightDecor.dispose();
  if (shakeLeftDecor) shakeLeftDecor.dispose();

  const [rightPx, leftPx] =
    SHAKE_INTENSITY_TABLE[shakeIntensity] ?? SHAKE_INTENSITY_TABLE[3];

  shakeRightDecor = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    textDecoration: `none; margin-left: ${rightPx}px`,
  });

  shakeLeftDecor = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    textDecoration: `none; margin-left: ${leftPx}px`,
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function getConnectedCount(): number {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) count++;
  });
  return count;
}

function updateStatusBar() {
  if (!statusBarItem) return;
  if (activePort !== undefined) {
    const ip = getLocalIP();
    const count = getConnectedCount();
    statusBarItem.text = `$(broadcast) Vibe: ${ip}:${activePort} (${count} connected)`;
    statusBarItem.tooltip = `Vibe Coding Server\nhttp://${ip}:${activePort}\nClick to stop`;
  } else {
    statusBarItem.text = `$(pulse) Vibe Coding: Active`;
    statusBarItem.tooltip = `Vibe Coding (editor shake only)\nClick to stop`;
  }
  statusBarItem.command = "vibe-coding.stop";
  statusBarItem.show();
}

function tryListen(
  server: http.Server,
  port: number,
  maxRetries: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const try_ = (p: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < maxRetries) {
          attempt++;
          try_(p + 1);
        } else {
          reject(err);
        }
      });
      server.listen(p, "0.0.0.0", () => resolve(p));
    };
    try_(port);
  });
}

async function startHttpServer(context: vscode.ExtensionContext) {
  if (httpServer) return;

  const mediaPath = path.join(context.extensionPath, "media");

  httpServer = http.createServer((req, res) => {
    let filePath: string;
    if (req.url === "/" || req.url === "/index.html") {
      filePath = path.join(mediaPath, "index.html");
    } else {
      const safePath = path
        .normalize(req.url ?? "")
        .replace(/^(\.\.[/\\])+/, "");
      filePath = path.join(mediaPath, safePath);
    }

    // Prevent directory traversal
    if (!filePath.startsWith(mediaPath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });

  wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (socket) => {
    updateStatusBar();
    socket.on("close", () => setTimeout(updateStatusBar, 100));
  });

  try {
    activePort = await tryListen(httpServer, 8765, 10);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to start server: ${err}`);
    httpServer = undefined;
    wss = undefined;
  }
}

function stopHttpServer() {
  if (wss) {
    wss.clients.forEach((client) => client.close());
    wss.close();
    wss = undefined;
  }

  if (httpServer) {
    httpServer.close();
    httpServer = undefined;
  }

  activePort = undefined;
}

function shakeEditor() {
  if (!shakeEnabled || isShaking) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  isShaking = true;
  const ranges = editor.visibleRanges.map(
    (r) => new vscode.Range(r.start, r.end)
  );

  const [, , stepDuration] =
    SHAKE_INTENSITY_TABLE[shakeIntensity] ?? SHAKE_INTENSITY_TABLE[3];

  // Step 1: shift right
  editor.setDecorations(shakeRightDecor, ranges);
  editor.setDecorations(shakeLeftDecor, []);

  setTimeout(() => {
    // Step 2: shift left
    editor.setDecorations(shakeRightDecor, []);
    editor.setDecorations(shakeLeftDecor, ranges);

    setTimeout(() => {
      // Step 3: clear
      editor.setDecorations(shakeRightDecor, []);
      editor.setDecorations(shakeLeftDecor, []);
      isShaking = false;
    }, stepDuration);
  }, stepDuration);
}

function broadcastVibration() {
  if (!wss) return;
  const msg = JSON.stringify({ type: "vibrate" });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function onTyping() {
  shakeEditor();
  broadcastVibration();
}

async function start(context: vscode.ExtensionContext) {
  if (textChangeDisposable) {
    vscode.window.showInformationMessage("Vibe Coding is already running.");
    return;
  }

  // Throttled text change listener (50ms)
  let lastAction = 0;
  let throttleTimer: ReturnType<typeof setTimeout> | undefined;

  textChangeDisposable = vscode.workspace.onDidChangeTextDocument(() => {
    const now = Date.now();
    const elapsed = now - lastAction;

    if (elapsed >= 50) {
      onTyping();
      lastAction = now;
    } else if (!throttleTimer) {
      throttleTimer = setTimeout(() => {
        onTyping();
        lastAction = Date.now();
        throttleTimer = undefined;
      }, 50 - elapsed);
    }
  });

  context.subscriptions.push(textChangeDisposable);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBarItem);

  // Server (optional)
  if (serverEnabled) {
    await startHttpServer(context);
  }

  updateStatusBar();

  if (activePort !== undefined) {
    const ip = getLocalIP();
    vscode.window.showInformationMessage(
      `Vibe Coding started: http://${ip}:${activePort}`
    );
  } else {
    vscode.window.showInformationMessage("Vibe Coding started");
  }
}

function stop() {
  if (!textChangeDisposable && !httpServer) {
    return;
  }

  if (textChangeDisposable) {
    textChangeDisposable.dispose();
    textChangeDisposable = undefined;
  }

  stopHttpServer();

  if (statusBarItem) {
    statusBarItem.hide();
    statusBarItem.dispose();
    statusBarItem = undefined;
  }

  vscode.window.showInformationMessage("Vibe Coding stopped.");
}

export function activate(context: vscode.ExtensionContext) {
  // Initialize settings and decorations
  getConfig();
  createShakeDecorations();

  // React to settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      const shakeChanged =
        e.affectsConfiguration("vibeCoding.editorShake.enabled") ||
        e.affectsConfiguration("vibeCoding.editorShake.intensity");
      const serverChanged = e.affectsConfiguration("vibeCoding.server.enabled");

      if (!shakeChanged && !serverChanged) return;

      const wasServerRunning = !!httpServer;
      getConfig();

      if (shakeChanged) {
        createShakeDecorations();
      }

      // Dynamically start/stop server while running
      if (serverChanged && textChangeDisposable) {
        if (serverEnabled && !wasServerRunning) {
          startHttpServer(context).then(updateStatusBar);
        } else if (!serverEnabled && wasServerRunning) {
          stopHttpServer();
          updateStatusBar();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vibe-coding.start", () => start(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vibe-coding.stop", () => stop())
  );
}

export function deactivate() {
  stop();
}
