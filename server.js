// server.js – FINAL FIXED VERSION
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

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
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
// Routes with error handling
// =======================================================
try {
  app.use('/api/auth', require('./routes/auth'));
  console.log('✅ Auth routes loaded');
} catch (err) {
  console.error('❌ Auth routes error:', err.message);
}

try {
  app.use('/api/user', require('./routes/user'));
  console.log('✅ User routes loaded');
} catch (err) {
  console.error('❌ User routes error:', err.message);
}

try {
  app.use('/api/predict', require('./routes/predict'));
  console.log('✅ Predict routes loaded');
} catch (err) {
  console.error('❌ Predict routes error:', err.message);
}

try {
  app.use('/api/performance', require('./routes/performance'));
  console.log('✅ Performance routes loaded');
} catch (err) {
  console.error('❌ Performance routes error:', err.message);
}

try {
  app.use('/api/llm', require('./routes/llm'));
  console.log('✅ LLM routes loaded');
} catch (err) {
  console.error('❌ LLM routes error:', err.message);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: "OK",
    mongo: mongoose.connection.readyState === 1 ? "Connected" : "Disconnected",
    llm_configured: !!process.env.LLM_URL,
    ml_configured: !!process.env.PREDICTION_MODEL_URL
  });
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'DermaDetect API',
    version: '1.0.0'
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
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
