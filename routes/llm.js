// routes/llm.js – FINAL TINYLLAMA WORKING VERSION

const express = require('express');
const router = express.Router();
const axios = require('axios');
const Prediction = require('../models/Prediction');
const authMiddleware = require('../middleware/auth');

// ============================================================
// Load TinyLlama Space URL from Railway
// ============================================================
const LLM_URL = process.env.LLM_URL;

console.log("========================================");
console.log("🚀 LLM System Initialized");
console.log("🔥 Using TinyLlama at:", LLM_URL);
console.log("========================================");

if (!LLM_URL) {
    console.error("❌ ERROR: LLM_URL is NOT SET in Railway");
}

// ============================================================
// Build medical advice prompt
// ============================================================
function buildPrompt(disease, symptoms, severity, duration, confidence) {
    const conf = confidence ? (confidence * 100).toFixed(0) : "N/A";

    return `
You are a dermatology medical assistant.

Condition: ${disease}
Symptoms: ${symptoms || "Not provided"}
Severity: ${severity || "Not provided"}
Duration: ${duration || "Not provided"}
AI Confidence: ${conf}%

Write a helpful, medically accurate explanation under these sections:

### 1️⃣ Overview  
### 2️⃣ Causes  
### 3️⃣ Symptoms  
### 4️⃣ Safe Home Care  
### 5️⃣ Dermatologist Treatments  
### 6️⃣ When To Seek Medical Help  
### 7️⃣ Prevention Tips  

Keep language simple and safe.
End with: "⚠️ AI-generated advice. Consult a dermatologist."
`;
}

// ============================================================
// Call TinyLlama HF Space
// ============================================================
async function callTinyLlama(prompt) {
    console.log("📩 Sending prompt to TinyLlama…");

    const response = await axios.post(
        LLM_URL,
        { text: prompt },
        {
            headers: { "Content-Type": "application/json" },
            timeout: 45000, // 45s timeout
        }
    );

    if (!response.data || !response.data.response) {
        console.error("❌ Invalid LLM response:", response.data);
        throw new Error("Invalid response from TinyLlama Space.");
    }

    console.log("✅ TinyLlama reply received:", response.data.response.length, "chars");
    return response.data.response.trim();
}

// ============================================================
// Generate Advice Wrapper
// ============================================================
async function generateAdvice(disease, symptoms, severity, duration, confidence) {
    const prompt = buildPrompt(disease, symptoms, severity, duration, confidence);
    return await callTinyLlama(prompt);
}

// ============================================================
// POST /api/llm/advice
// ============================================================
router.post('/advice', authMiddleware, async (req, res) => {
    try {
        const { disease, symptoms, severity, duration, predictionId, confidence } = req.body;

        if (!disease) {
            return res.status(400).json({
                success: false,
                message: "Disease is required"
            });
        }

        console.log("🧠 Generating advice for:", disease);

        const advice = await generateAdvice(
            disease,
            symptoms,
            severity,
            duration,
            confidence
        );

        // Save advice to prediction
        if (predictionId) {
            await Prediction.findByIdAndUpdate(predictionId, {
                advice,
                adviceGeneratedAt: new Date(),
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
            error: err.message,
        });
    }
});

// ============================================================
// GET /api/llm/health
// ============================================================
router.get('/health', (req, res) => {
    res.json({
        success: true,
        llm_url: LLM_URL,
        configured: !!LLM_URL
    });
});

module.exports = router;
