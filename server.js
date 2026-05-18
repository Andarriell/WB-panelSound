require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const multer = require("multer");

const app = express();

const PORT = Number(process.env.PANEL_PORT || 3000);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || "change-moi";
const MC_WS_URL = process.env.MC_WS_URL || "ws://127.0.0.1:8765";

const MUSIC_DIR = path.join(__dirname, "music");
const PUBLIC_DIR = path.join(__dirname, "public");

const FRAME_SIZE = 1920;
const HEARTBEAT_INTERVAL_MS = 10000;

let currentProcess = null;
let currentWs = null;
let heartbeatTimer = null;
let currentVolume = 1;
let isStreaming = false;
let streamName = null;
let lastLogs = [];

if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  console.log(line);
  lastLogs.push(line);
  if (lastLogs.length > 200) lastLogs.shift();
}

function safeFileName(name) {
  return path.basename(name || "").replace(/[^a-zA-Z0-9._ -]/g, "_");
}

function checkAuth(req, res, next) {
  const authorization = String(req.headers["authorization"] || "");

  const token = authorization
    .replace(/^Bearer\s+/i, "")
    .trim();

  const panelPassword = String(PANEL_PASSWORD || "").trim();

  if (token !== panelPassword) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(ws) {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      ws.send(JSON.stringify({
        type: "pong",
        timestamp: Date.now()
      }));

      log("Heartbeat pong envoyé");
    } catch (err) {
      log(`Erreur heartbeat : ${err.message}`);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function connectMinecraftWs() {
  return new Promise((resolve, reject) => {
    if (currentWs && currentWs.readyState === WebSocket.OPEN) {
      return resolve(currentWs);
    }

    log(`Connexion au plugin Minecraft : ${MC_WS_URL}`);

    const ws = new WebSocket(MC_WS_URL);
    currentWs = ws;

    const timeout = setTimeout(() => {
      reject(new Error("Timeout connexion WebSocket Minecraft"));
    }, 8000);

    ws.on("open", () => {
      clearTimeout(timeout);

      log("Connecté au plugin Minecraft");

      ws.send(JSON.stringify({
        type: "voice_config",
        enabled: true,
        channel_type: "static",
        distance: 100,
        zone: "main"
      }));

      startHeartbeat(ws);
      resolve(ws);
    });

    ws.on("message", (data) => {
      const text = data.toString();

      if (!text.includes("pong")) {
        log(`Message Minecraft WS : ${text}`);
      }

      try {
        const msg = JSON.parse(text);

        if (msg.type === "ping") {
          ws.send(JSON.stringify({
            type: "pong",
            timestamp: Date.now()
          }));

          log("Pong envoyé au plugin Minecraft");
        }
      } catch (err) {
        // Ignore les messages non JSON
      }
    });

    ws.on("close", (code, reason) => {
      log(`WebSocket Minecraft fermé : code=${code}, reason=${reason || "aucune"}`);
      stopHeartbeat();

      if (currentWs === ws) {
        currentWs = null;
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      log(`Erreur WebSocket Minecraft : ${err.message}`);
      reject(err);
    });
  });
}

function stopStream() {
  isStreaming = false;
  streamName = null;

  if (currentProcess) {
    log("Arrêt FFmpeg...");
    currentProcess.kill("SIGTERM");
    currentProcess = null;
  }

  if (currentWs && currentWs.readyState === WebSocket.OPEN) {
    currentWs.send(JSON.stringify({
      type: "voice_config",
      enabled: false
    }));
  }

  log("Stream arrêté.");
}

async function startAudio(input, name, isLive = false) {
  stopStream();

  const ws = await connectMinecraftWs();

  log(`Lancement FFmpeg : ${name}`);

  const ffmpegArgs = [
    ...(isLive ? [] : ["-re"]),
    "-i", input,
    "-filter:a", `volume=${currentVolume}`,
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "-ac", "1",
    "-ar", "48000",
    "-"
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"]
  });

  currentProcess = ffmpeg;
  isStreaming = true;
  streamName = name;

  let buffer = Buffer.alloc(0);

  ffmpeg.stdout.on("data", (chunk) => {
    if (!isStreaming) return;

    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= FRAME_SIZE) {
      const frame = buffer.subarray(0, FRAME_SIZE);
      buffer = buffer.subarray(FRAME_SIZE);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "voice_audio",
          codec: "pcm",
          data: frame.toString("base64")
        }));
      }
    }
  });

  ffmpeg.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) log(`FFmpeg : ${text}`);
  });

  ffmpeg.on("close", (code) => {
    log(`FFmpeg terminé avec code ${code}`);
    isStreaming = false;
    streamName = null;
    currentProcess = null;
  });

  ffmpeg.on("error", (err) => {
    log(`Erreur FFmpeg : ${err.message}`);
    isStreaming = false;
    streamName = null;
    currentProcess = null;
  });
}

const upload = multer({
  dest: MUSIC_DIR,
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

app.post("/api/login", (req, res) => {
  if (req.body.password === PANEL_PASSWORD) {
    return res.json({ ok: true });
  }

  res.status(401).json({ error: "Mot de passe incorrect" });
});

app.get("/api/status", checkAuth, (req, res) => {
  res.json({
    ok: true,
    streaming: isStreaming,
    streamName,
    volume: currentVolume,
    mcWsUrl: MC_WS_URL,
    wsConnected: currentWs?.readyState === WebSocket.OPEN,
    logs: lastLogs
  });
});

app.get("/api/logs", checkAuth, (req, res) => {
  res.json({ logs: lastLogs });
});

app.get("/api/music", checkAuth, (req, res) => {
  const files = fs.readdirSync(MUSIC_DIR)
    .filter(file => /\.(mp3|wav|ogg|flac|m4a)$/i.test(file));

  res.json({ files });
});

app.post("/api/upload", checkAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Aucun fichier envoyé" });
  }

  const cleanName = safeFileName(req.file.originalname);
  const finalPath = path.join(MUSIC_DIR, cleanName);

  fs.renameSync(req.file.path, finalPath);

  log(`Fichier uploadé : ${cleanName}`);

  res.json({ ok: true, file: cleanName });
});

app.post("/api/play", checkAuth, async (req, res) => {
  try {
    const file = safeFileName(req.body.file);
    const filePath = path.join(MUSIC_DIR, file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Fichier introuvable" });
    }

    await startAudio(filePath, `MP3/Fichier : ${file}`, false);

    res.json({ ok: true });
  } catch (err) {
    log(`Erreur play : ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/play-file", checkAuth, async (req, res) => {
  try {
    const file = safeFileName(req.body.file);
    const filePath = path.join(MUSIC_DIR, file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Fichier introuvable" });
    }

    await startAudio(filePath, `MP3/Fichier : ${file}`, false);

    res.json({ ok: true });
  } catch (err) {
    log(`Erreur play-file : ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/stream-url", checkAuth, async (req, res) => {
  try {
    const url = req.body.url;

    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL invalide" });
    }

    await startAudio(url, `Flux live : ${url}`, true);

    res.json({ ok: true });
  } catch (err) {
    log(`Erreur flux URL : ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/stop", checkAuth, (req, res) => {
  stopStream();
  res.json({ ok: true });
});

app.post("/api/volume", checkAuth, (req, res) => {
  const volume = Number(req.body.volume);

  if (Number.isNaN(volume) || volume < 0 || volume > 3) {
    return res.status(400).json({ error: "Volume invalide. Valeur entre 0 et 3." });
  }

  currentVolume = volume;
  log(`Volume défini à ${currentVolume}`);

  res.json({ ok: true, volume: currentVolume });
});

app.post("/api/test-minecraft", checkAuth, async (req, res) => {
  try {
    const ws = await connectMinecraftWs();

    ws.send(JSON.stringify({
      type: "pong",
      timestamp: Date.now()
    }));

    res.json({
      ok: true,
      message: "Connexion au plugin Minecraft OK",
      url: MC_WS_URL
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      url: MC_WS_URL
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  log(`Audio Panel lancé sur http://0.0.0.0:${PORT}`);
  log(`Mot de passe panel : ${PANEL_PASSWORD ? "défini" : "non défini"}`);
  log(`WebSocket Minecraft cible : ${MC_WS_URL}`);
});