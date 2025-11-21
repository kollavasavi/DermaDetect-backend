// server.js - UPDATED with TinyLlama API Integration

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require("axios");

dotenv.config();
const app = express();

// =======================================================
// 1️⃣ CONFIG
// =======================================================
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || 'development';
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/skinDiseaseDB";
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

// =======================================================
// 🔥 HuggingFace TinyLlama API
// =======================================================
async function queryTinyLlama(prompt) {
  const HF_TOKEN = process.env.HF_TOKEN;

  if (!HF_TOKEN) {
    console.error("❌ ERROR: HF_TOKEN missing in Railway Variables");
    throw new Error("HF_TOKEN is not set");
  }

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/TinyLlama/TinyLlama-1.1B-Chat-v1.0",
    { inputs: prompt },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
      },
    }
  );

  return response.data;
}

// =======================================================
// 2️⃣ Middleware
// =======================================================
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.path}`);
  next();
});

// =======================================================
// 3️⃣ MongoDB Connection
// =======================================================
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err.message));

// =======================================================
// 4️⃣ API Routes
// =======================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/predict', require('./routes/predict'));
app.use('/api/performance', require('./routes/performance'));

const llmRouter = require('./routes/llm');
app.use('/api/llm', llmRouter);
app.use('/llm', llmRouter);

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({
    status: "OK",
    mongo: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    timestamp: new Date(),
  });
});

// =======================================================
// 🔥 5️⃣ TinyLlama API Route
// =======================================================
app.post("/api/ask-llama", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const llamaResponse = await queryTinyLlama(prompt);

    res.json({ response: llamaResponse });

  } catch (err) {
    console.error("❌ TinyLlama Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to contact TinyLlama API" });
  }
});

// =======================================================
// 6️⃣ Serve React Frontend Build (Optional)
// =======================================================
const buildPath = path.join(__dirname, 'frontend', 'build');

if (fs.existsSync(buildPath)) {
  console.log("📦 Serving React frontend from:", buildPath);

  app.use(express.static(buildPath, {
    maxAge: '1d',
    etag: true
  }));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/llm')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(buildPath, 'index.html'));
  });

} else {
  console.log("⚠️ Frontend build NOT found");
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/llm')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(503).send("Frontend not built");
  });
}

// =======================================================
// 7️⃣ Start Server
// =======================================================
app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log("📡 Network addresses:");
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`→ http://${net.address}:${PORT}`);
      }
    }
  }
  console.log("\n⏳ Waiting for requests...\n");
});

module.exports = app;
