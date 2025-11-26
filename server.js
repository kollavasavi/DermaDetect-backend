// server.js - UPDATED with TinyLlama API Integration

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const axios = require("axios");

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

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
// 6️⃣ Backend is API-only (Frontend deployed on Vercel)
// =======================================================
console.log("🚀 Backend running in API-only mode");
console.log("🌐 Frontend deployed separately on Vercel");

// Catch-all for undefined routes - return 404 JSON
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    message: 'This is an API-only backend. Frontend is on Vercel.',
    availableRoutes: [
      '/api/auth/signup',
      '/api/auth/login',
      '/api/health',
      '/api/user',
      '/api/predict',
      '/api/llm',
      '/api/ask-llama'
    ]
  });
});

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
// force rebuild


