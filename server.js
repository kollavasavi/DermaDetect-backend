// server.js - FIXED: Properly serve React app through ngrok

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const os = require('os');
const fs = require('fs');
const path = require('path');

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
// 2️⃣ Middleware - FIXED ORDER
// =======================================================
// CORS must be first
app.use(cors({ 
  origin: '*',  // Allow all origins for ngrok
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
// 3️⃣ MongoDB
// =======================================================
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err.message));

// =======================================================
// 4️⃣ API Routes FIRST (before static files)
// =======================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/predict', require('./routes/predict'));
app.use('/api/performance', require('./routes/performance'));

// LLM routes
const llmRouter = require('./routes/llm');
app.use('/api/llm', llmRouter);
app.use('/llm', llmRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: "OK",
    mongo: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    timestamp: new Date(),
  });
});

// =======================================================
// 5️⃣ Serve React Frontend - AFTER API routes
// =======================================================
const buildPath = path.join(__dirname, 'frontend', 'build');

if (fs.existsSync(buildPath)) {
  console.log("📦 Serving React frontend from:", buildPath);

  // Serve static files
  app.use(express.static(buildPath, {
    maxAge: '1d',
    etag: true
  }));

  // Handle React Router - MUST be last
  app.get('*', (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/llm')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    res.sendFile(path.join(buildPath, 'index.html'));
  });
} else {
  console.log("⚠️ Frontend build NOT found at:", buildPath);
  console.log("Run: cd frontend && npm run build");
  
  // Fallback message
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/llm')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(503).send(`
      <html>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h1>🚧 Frontend Not Built</h1>
          <p>Please build the frontend first:</p>
          <code>cd frontend && npm run build</code>
        </body>
      </html>
    `);
  });
}

// =======================================================
// 6️⃣ Start Server
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
  console.log("\n✅ Ready for ngrok: ngrok http 5000");
  console.log("⏳ Waiting for requests...\n");
});

module.exports = app;