// routes/llm.js – FINAL CLEAN TINYLLAMA INTEGRATION

const express = require('express');
const router = express.Router();
const axios = require('axios');
const Prediction = require('../models/Prediction');
const authMiddleware = require('../middleware/auth');

// ============================================================
// Load TinyLlama Space URL
// ============================================================
const LLM_URL = process.env.LLM_URL;

console.log("==================================");
console.log("🔥 Using TinyLlama at:", LLM_URL);
console.log("==================================");

if (!LLM_URL) {
  console.error("❌ ERROR: LLM_URL not set in Railway!");
}

// ============================================================
// Build the prompt sent to TinyLlama
// ============================================================
function buildPrompt(disease, symptoms, severity, duration, confidence) {
  return `
You are a dermatology medical assistant.

Condition: ${disease}
Symptoms: ${symptoms || 'Not provided'}
Severity: ${severity || 'Not provided'}
Duration: ${duration || 'Not provided'}
Confidence: ${(confidence * 100).toFixed(0)}%

Write a safe, medically accurate explanation using these sections:

### 1️⃣ What the condition is  
### 2️⃣ Common symptoms  
### 3️⃣ Causes  
### 4️⃣ Safe home care  
### 5️⃣ Dermatologist treatments  
### 6️⃣ When to see a doctor  
### 7️⃣ Prevention tips  

End with: "⚠️ AI-generated advice. Consult a dermatologist."
`;
}

// ============================================================
// Send prompt to TinyLlama HF Space
// ============================================================
async function callTinyLlama(prompt) {
  console.log("💬 Sending prompt to TinyLlama...");

  const response = await axios.post(
    LLM_URL,
    { text: prompt },
    { headers: { "Content-Type": "application/json" }, timeout: 45000 }
  );

  if (!response.data || !response.data.response) {
    console.error("❌ Invalid LLM response:", response.data);
    throw new Error("Invalid response from TinyLlama Space");
  }

  console.log("✅ TinyLlama responded:", response.data.response.length, "chars");
  return response.data.response.trim();
}

// ============================================================
// Main advice generator
// ============================================================
async function generateAdvice(disease, symptoms, severity, duration, confidence) {
  const prompt = buildPrompt(disease, symptoms, severity, duration, confidence);
  return await callTinyLlama(prompt);
}

// ============================================================
// API Route: POST /api/llm/advice
// ============================================================
router.post('/advice', authMiddleware, async (req, res) => {
  try {
    const { disease, symptoms, severity, duration, predictionId, confidence } = req.body;

    if (!disease) {
      return res.status(400).json({ success: false, message: "Disease is required" });
    }

    console.log("🔥 Generating advice for:", disease);

    const advice = await generateAdvice(
      disease,
      symptoms,
      severity,
      duration,
      confidence
    );

    // Save in DB
    if (predictionId) {
      await Prediction.findByIdAndUpdate(predictionId, {
        advice,
        adviceGeneratedAt: new Date()
      });
    }

    res.json({
      success: true,
      advice,
      metadata: {
        model: "TinyLlama HF Space",
        llm_url: LLM_URL,
        generated_at: new Date(),
      }
    });

  } catch (err) {
    console.error("❌ LLM Error:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate advice",
      error: err.message
    });
  }
});

// Simple health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    llm_url: LLM_URL,
    configured: !!LLM_URL
  });
});

module.exports = router;
