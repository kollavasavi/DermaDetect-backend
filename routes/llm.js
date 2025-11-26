// routes/llm.js – FINAL FIXED VERSION

const express = require("express");
const router = express.Router();
const axios = require("axios");
const mongoose = require("mongoose");
const Prediction = require("../models/Prediction");
const authMiddleware = require("../middleware/auth");

// ============================================================
// Load HuggingFace Space URL
// ============================================================
const LLM_URL = process.env.LLM_URL;

console.log("==================================");
console.log("🔥 Using TinyLlama at:", LLM_URL);
console.log("==================================");

if (!LLM_URL) {
  console.error("❌ ERROR: LLM_URL NOT SET IN RAILWAY!");
}

// ============================================================
// Build Prompt
// ============================================================
function buildPrompt(disease, symptoms, severity, duration, confidence) {
  return `
You are a dermatology medical assistant.

Condition: ${disease}
Symptoms: ${symptoms || "Not provided"}
Severity: ${severity || "Not provided"}
Duration: ${duration || "Not provided"}
Confidence: ${(confidence * 100).toFixed(0)}%

Write a clear, safe explanation using:

1. What the condition is  
2. Common symptoms  
3. Causes  
4. Safe home care  
5. Dermatologist treatments  
6. When to see a doctor  
7. Prevention tips  

End with: "⚠️ AI-generated advice. Consult a dermatologist."
`;
}

// ============================================================
// CALL TINYLLAMA (5 minute timeout, wait_for_model)
// ============================================================
async function callTinyLlama(prompt) {
  console.log("💬 Sending prompt to TinyLlama...");

  try {
    const response = await axios.post(
      LLM_URL,
      { text: prompt, wait_for_model: true },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 300000, // 🔥 5 MINUTES — REQUIRED FOR HF SPACES
      }
    );

    console.log("📩 Raw HF Response:", response.data);

    // Handle all HF Space formats:
    if (response.data?.response) return response.data.response.trim();
    if (response.data?.generated_text) return response.data.generated_text.trim();
    if (Array.isArray(response.data) && response.data[0]?.generated_text)
      return response.data[0].generated_text.trim();

    throw new Error("Unrecognized TinyLlama response format");

  } catch (err) {
    console.error("❌ TinyLlama ERROR:", err.message);
    throw err;
  }
}

// ============================================================
// Generate Advice
// ============================================================
async function generateAdvice(disease, symptoms, severity, duration, confidence) {
  const prompt = buildPrompt(disease, symptoms, severity, duration, confidence);
  return await callTinyLlama(prompt);
}

// ============================================================
// POST /api/llm/advice
// ============================================================
router.post("/advice", authMiddleware, async (req, res) => {
  try {
    const { disease, symptoms, severity, duration, predictionId, confidence } =
      req.body;

    if (!disease) {
      return res.status(400).json({
        success: false,
        message: "Disease is required",
      });
    }

    console.log("🔥 Generating advice for:", disease);

    const advice = await generateAdvice(
      disease,
      symptoms,
      severity,
      duration,
      confidence
    );

    // Save advice to DB (only if ObjectId is valid)
    if (predictionId) {
      if (mongoose.Types.ObjectId.isValid(predictionId)) {
        try {
          await Prediction.findByIdAndUpdate(predictionId, {
            advice,
            adviceGeneratedAt: new Date(),
          });
          console.log("✅ Saved advice to prediction:", predictionId);
        } catch (dbError) {
          console.error("⚠️ Could not save advice:", dbError.message);
        }
      } else {
        console.warn("⚠️ Invalid predictionId:", predictionId);
      }
    }

    res.json({
      success: true,
      advice,
      metadata: {
        model: "TinyLlama HF Space",
        llm_url: LLM_URL,
        generated_at: new Date(),
      },
    });

  } catch (err) {
    console.error("❌ LLM ERROR:", err.message);

    res.status(500).json({
      success: false,
      message: "Failed to generate advice",
      error: err.message,
    });
  }
});

// ============================================================
// GET /api/llm/health
// ============================================================
router.get("/health", (req, res) => {
  res.json({
    success: true,
    llm_url: LLM_URL,
    configured: !!LLM_URL,
  });
});

module.exports = router;
