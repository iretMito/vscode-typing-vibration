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
  if (!statusBarItem || activePort === undefined) return;
  const ip = getLocalIP();
  const count = getConnectedCount();
  statusBarItem.text = `$(broadcast) Vibration: ${ip}:${activePort} (${count} connected)`;
  statusBarItem.tooltip = `Vibe Coding Server\nhttp://${ip}:${activePort}\nClick to stop`;
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

async function startServer(context: vscode.ExtensionContext) {
  if (httpServer) {
    vscode.window.showInformationMessage(
      "Vibe Coding server is already running."
    );
    return;
  }

  const mediaPath = path.join(context.extensionPath, "media");

  httpServer = http.createServer((req, res) => {
    let filePath: string;
    if (req.url === "/" || req.url === "/index.html") {
      filePath = path.join(mediaPath, "index.html");
    } else {
      const safePath = path.normalize(req.url ?? "").replace(/^(\.\.[/\\])+/, "");
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
    vscode.window.showErrorMessage(
      `Failed to start server: ${err}`
    );
    httpServer = undefined;
    wss = undefined;
    return;
  }

  // Throttled text change listener (50ms)
  let lastBroadcast = 0;
  let throttleTimer: ReturnType<typeof setTimeout> | undefined;

  textChangeDisposable = vscode.workspace.onDidChangeTextDocument(() => {
    const now = Date.now();
    const elapsed = now - lastBroadcast;

    if (elapsed >= 50) {
      broadcast();
      lastBroadcast = now;
    } else if (!throttleTimer) {
      throttleTimer = setTimeout(() => {
        broadcast();
        lastBroadcast = Date.now();
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
  updateStatusBar();

  const ip = getLocalIP();
  vscode.window.showInformationMessage(
    `Vibe Coding started: http://${ip}:${activePort}`
  );
}

function broadcast() {
  if (!wss) return;
  const msg = JSON.stringify({ type: "vibrate" });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function stopServer() {
  if (textChangeDisposable) {
    textChangeDisposable.dispose();
    textChangeDisposable = undefined;
  }

  if (wss) {
    wss.clients.forEach((client) => client.close());
    wss.close();
    wss = undefined;
  }

  if (httpServer) {
    httpServer.close();
    httpServer = undefined;
  }

  if (statusBarItem) {
    statusBarItem.hide();
    statusBarItem.dispose();
    statusBarItem = undefined;
  }

  activePort = undefined;
  vscode.window.showInformationMessage("Vibe Coding server stopped.");
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("vibe-coding.start", () =>
      startServer(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vibe-coding.stop", () => stopServer())
  );
}

export function deactivate() {
  stopServer();
}
