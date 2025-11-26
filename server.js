// server.js – FINAL CLEAN VERSION USING TINYLLAMA HF SPACE

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const os = require('os');

// Load .env ONLY in local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// =======================================================
// CONFIG
// =======================================================
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";
const MONGODB_URI = process.env.MONGODB_URI;

console.log("====== ENV DEBUG ======");
console.log("LLM_URL:", process.env.LLM_URL);
console.log("PREDICTION_MODEL_URL:", process.env.PREDICTION_MODEL_URL);
console.log("========================");

// =======================================================
// Middleware
// =======================================================
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.path}`);
  next();
});

// =======================================================
// MongoDB
// =======================================================
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err.message));

// =======================================================
// Routes
// =======================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/predict', require('./routes/predict'));
app.use('/api/performance', require('./routes/performance'));

const llmRoutes = require('./routes/llm');
app.use('/api/llm', llmRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: "OK",
    mongo: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"
  });
});

// Catch-all
app.use('*', (req, res) => {
  res.status(404).json({
    error: "Route not found",
    message: "Backend API only. Frontend hosted separately."
  });
});

// =======================================================
// Start Server
// =======================================================
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server started at http://localhost:${PORT}`);
});

module.exports = app;
