// Vibe Coding - 3-Layer Vibration Engine

(function () {
  "use strict";

  // --- DOM Elements ---
  const statusEl = document.getElementById("status");
  const startBtn = document.getElementById("startBtn");
  const counterEl = document.getElementById("counter");
  const flashEl = document.getElementById("flash");
  const iosSwitch = document.getElementById("iosSwitch");

  // --- State ---
  let started = false;
  let vibrateCount = 0;
  let vibrateDuration = 80;
  let ws = null;
  let reconnectDelay = 1000;
  const MAX_RECONNECT_DELAY = 30000;

  // --- Platform Detection ---
  const hasVibrate = typeof navigator.vibrate === "function";
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // --- Audio Context (Layer 3) ---
  let audioCtx = null;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  // --- Layer 1: navigator.vibrate (Android) ---
  function vibrateNative() {
    if (hasVibrate) {
      navigator.vibrate(vibrateDuration);
    }
  }

  // --- Layer 2: iOS checkbox switch haptic hack ---
  // Use two switches and alternate between them to ensure consistent haptic
  var iosSwitchA = iosSwitch;
  var iosSwitchB = null;
  var useA = true;

  function initIOSSwitches() {
    if (!isIOS || !iosSwitch) return;
    iosSwitchB = iosSwitch.cloneNode(true);
    iosSwitchB.id = "iosSwitchB";
    iosSwitch.parentNode.appendChild(iosSwitchB);
    // Pre-set A=unchecked, B=checked so each click is always a state change
    iosSwitchA.checked = false;
    iosSwitchB.checked = true;
  }

  function vibrateIOSHack() {
    if (!isIOS) return;
    if (useA && iosSwitchA) {
      iosSwitchA.click();
    } else if (iosSwitchB) {
      iosSwitchB.click();
    }
    useA = !useA;
  }

  // --- Layer 3: Low-frequency sound fallback ---
  function vibrateLowFreq() {
    if (!audioCtx) return;

    const duration = 0.03; // 30ms
    const now = audioCtx.currentTime;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(50, now); // 50Hz

    // Fade in/out to prevent click noise
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.5, now + 0.005);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  // --- Visual Flash Feedback ---
  function flashScreen() {
    flashEl.classList.add("active");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flashEl.classList.remove("active");
      });
    });
  }

  // --- Combined Vibration Trigger ---
  function triggerVibration() {
    if (!started) return;

    // Execute all 3 layers simultaneously
    vibrateNative();
    vibrateIOSHack();
    vibrateLowFreq();

    // Visual feedback
    flashScreen();

    // Update counter
    vibrateCount++;
    counterEl.textContent = vibrateCount;
  }

  // --- WebSocket Connection ---
  function setStatus(state, text) {
    statusEl.className = "status " + state;
    statusEl.textContent = text;
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = protocol + "//" + location.host;

    setStatus("connecting", "Connecting...");
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      setStatus("connected", "Connected");
      reconnectDelay = 1000; // Reset backoff
    };

    ws.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "vibrate") {
          triggerVibration();
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.onclose = function () {
      ws = null;
      setStatus("disconnected", "Disconnected");
      scheduleReconnect();
    };

    ws.onerror = function () {
      if (ws) ws.close();
    };
  }

  function scheduleReconnect() {
    setTimeout(function () {
      if (!ws) connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  // --- Start Button ---
  startBtn.addEventListener("click", function () {
    if (started) return;
    started = true;

    // Initialize audio (must be from user gesture)
    initAudio();

    // Initialize iOS dual-switch system
    initIOSSwitches();

    // Trigger initial iOS switch click to prime haptic
    if (isIOS && iosSwitch) {
      iosSwitch.click();
    }

    // Test vibration
    if (hasVibrate) {
      navigator.vibrate(100);
    }

    startBtn.classList.add("active");
    startBtn.innerHTML = "ACTIVE";
  });

  // --- Vibration Duration Slider ---
  var sliderEl = document.getElementById("vibrateSlider");
  var valueEl = document.getElementById("vibrateValue");
  if (sliderEl) {
    sliderEl.addEventListener("input", function () {
      vibrateDuration = parseInt(sliderEl.value, 10);
      valueEl.textContent = vibrateDuration + "ms";
    });
  }

  // --- Initialize ---
  connect();
})();
