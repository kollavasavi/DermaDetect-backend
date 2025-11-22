// routes/llm.js - Hugging Face Integration
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Prediction = require('../models/Prediction');
const authMiddleware = require('../middleware/auth');

// Configuration - USE HUGGING FACE
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL_URL = process.env.ML_MODEL_URL || 'https://api-inference.huggingface.co/models/TinyLlama/TinyLlama-1.1B-Chat-v1.0';
const USE_OPENAI = process.env.USE_OPENAI === 'true';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Timeout configuration (in milliseconds)
const GENERATION_TIMEOUT = parseInt(process.env.LLM_TIMEOUT) || 120000; // 2 minutes default

// Health check state
let hfAvailable = false;
let lastHealthCheck = null;

// Health check for Hugging Face API
async function checkHuggingFaceHealth() {
  if (!HF_TOKEN) {
    console.log('⚠️ HF_TOKEN not set in environment variables');
    hfAvailable = false;
    return false;
  }

  try {
    // Test the API with a simple request
    const response = await axios.post(
      HF_MODEL_URL,
      {
        inputs: "Hello",
        parameters: { max_new_tokens: 10 }
      },
      {
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000,
        validateStatus: (status) => status < 500
      }
    );
    
    if (response.status === 200 || response.status === 503) {
      // 503 means model is loading, which is OK
      hfAvailable = true;
      lastHealthCheck = new Date();
      console.log('✅ Hugging Face API is available');
      return true;
    }
    
    hfAvailable = false;
    return false;
  } catch (error) {
    hfAvailable = false;
    
    if (error.response?.status === 401) {
      console.log('⚠️ Invalid HF_TOKEN - check your Hugging Face token');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('⚠️ Hugging Face API timeout');
    } else {
      console.log('⚠️ Hugging Face health check failed:', error.message);
    }
    
    return false;
  }
}

// Initialize health check on startup
checkHuggingFaceHealth();

// Generate advice using LLM
async function generateAdviceWithLLM(disease, symptoms, severity, duration, confidence) {
  // Option 1: OpenAI
  if (USE_OPENAI && OPENAI_API_KEY) {
    return await generateWithOpenAI(disease, symptoms, severity, duration, confidence);
  }
  
  // Option 2: Hugging Face
  if (hfAvailable && HF_TOKEN) {
    return await generateWithHuggingFace(disease, symptoms, severity, duration, confidence);
  }
  
  // No LLM available
  throw new Error(
    `No LLM service available. Please set HF_TOKEN in Railway environment variables.`
  );
}

// OpenAI Integration
async function generateWithOpenAI(disease, symptoms, severity, duration, confidence) {
  try {
    const prompt = createMedicalPrompt(disease, symptoms, severity, duration, confidence);
    
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a knowledgeable medical information assistant specializing in dermatology. Provide detailed, evidence-based advice about skin conditions. Always include disclaimers about seeking professional medical attention for serious conditions.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 1500,
        presence_penalty: 0.1,
        frequency_penalty: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    if (!response.data?.choices?.[0]?.message?.content) {
      throw new Error('Invalid response from OpenAI');
    }

    return response.data.choices[0].message.content;
    
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Invalid OpenAI API key');
    } else if (error.response?.status === 429) {
      throw new Error('OpenAI rate limit exceeded. Please try again later');
    } else if (error.response?.status === 500) {
      throw new Error('OpenAI service error. Please try again later');
    }
    
    console.error('OpenAI error:', error.response?.data || error.message);
    throw new Error(`OpenAI error: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Hugging Face Integration
async function generateWithHuggingFace(disease, symptoms, severity, duration, confidence) {
  try {
    const prompt = createMedicalPrompt(disease, symptoms, severity, duration, confidence);
    
    console.log(`🤖 Generating advice with Hugging Face TinyLlama...`);
    console.log(`⏱️ Timeout set to ${GENERATION_TIMEOUT/1000} seconds`);

    const response = await axios.post(
      HF_MODEL_URL,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: 800,
          temperature: 0.7,
          top_p: 0.9,
          do_sample: true,
          return_full_text: false
        },
        options: {
          wait_for_model: true,
          use_cache: false
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: GENERATION_TIMEOUT,
        validateStatus: (status) => status < 500
      }
    );

    // Handle Hugging Face response format
    let advice = '';
    
    if (Array.isArray(response.data) && response.data[0]?.generated_text) {
      advice = response.data[0].generated_text;
    } else if (response.data?.generated_text) {
      advice = response.data.generated_text;
    } else if (typeof response.data === 'string') {
      advice = response.data;
    } else {
      throw new Error('Unexpected response format from Hugging Face');
    }

    console.log(`✅ Advice generated successfully (${advice.length} chars)`);
    return advice.trim();
    
  } catch (error) {
    // Enhanced error handling
    if (error.response?.status === 401) {
      throw new Error('Invalid HF_TOKEN - check your Hugging Face token in Railway variables');
    }
    
    if (error.response?.status === 503) {
      throw new Error('Hugging Face model is loading. Please try again in 20 seconds.');
    }
    
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      console.error(`❌ Timeout after ${GENERATION_TIMEOUT/1000}s`);
      throw new Error(
        `Generation timeout (${GENERATION_TIMEOUT/1000}s exceeded). ` +
        `The Hugging Face API is taking too long. Please try again.`
      );
    }
    
    if (error.response?.data?.error) {
      throw new Error(`Hugging Face error: ${error.response.data.error}`);
    }
    
    console.error('Hugging Face error:', error.message);
    throw new Error(`Hugging Face error: ${error.message}`);
  }
}

// Create comprehensive but concise medical prompt
function createMedicalPrompt(disease, symptoms, severity, duration, confidence) {
  const urgentConditions = ['melanoma', 'basal cell carcinoma', 'squamous cell carcinoma', 'stevens-johnson syndrome', 'cellulitis', 'sepsis'];
  const isUrgent = urgentConditions.some(cond => disease.toLowerCase().includes(cond));
  
  return `You are a dermatology medical assistant. Provide advice for: ${disease}

Patient Info:
- Condition: ${disease} (Confidence: ${confidence ? (confidence * 100).toFixed(0) + '%' : 'N/A'})
- Symptoms: ${symptoms || 'Not specified'}
- Severity: ${severity || 'moderate'}
- Duration: ${duration || 'Not specified'}

${isUrgent ? '⚠️ URGENT CONDITION - START WITH IMMEDIATE MEDICAL ATTENTION WARNING\n' : ''}
Provide concise advice (400-500 words) covering:

1. CONDITION OVERVIEW (2-3 sentences)
What is ${disease} and what causes it?

2. TREATMENT OPTIONS (3-4 key points)
- First-line treatments
- OTC options if applicable
- Home care tips

3. WHEN TO SEE A DOCTOR (2-3 warning signs)
${isUrgent ? '- Emphasize URGENT professional consultation needed' : '- Timeline for medical visit'}

4. PREVENTION & CARE (2-3 tips)
- Daily skincare
- What to avoid

IMPORTANT: 
- Keep response under 500 words
- Use simple language
- End with: "⚠️ This is AI-generated advice. Always consult a dermatologist for proper diagnosis."
- ${isUrgent ? 'Emphasize URGENT medical attention needed' : 'Note AI screening is not a diagnosis'}`;
}

// Allow public access for testing
const ALLOW_PUBLIC_LLM = process.env.ALLOW_PUBLIC_LLM === 'true';

// @route   POST /api/llm/advice
// @desc    Get LLM-generated advice for skin condition
// @access  Private (or public when ALLOW_PUBLIC_LLM=true)
async function adviceHandler(req, res) {
  try {
    const { disease, symptoms, severity, duration, predictionId, confidence } = req.body;

    // Validation
    if (!disease) {
      return res.status(400).json({ 
        success: false, 
        message: 'Disease information is required' 
      });
    }

    console.log(`🔥 Request: Generate advice for ${disease} (Severity: ${severity || 'not specified'})`);

    // Re-check health if needed
    if (!lastHealthCheck || (Date.now() - lastHealthCheck) > 30000) {
      await checkHuggingFaceHealth();
    }

    // Check LLM availability
    if (!hfAvailable && !USE_OPENAI) {
      return res.status(503).json({
        success: false,
        message: 'LLM service not available',
        details: {
          hf_token_set: !!HF_TOKEN,
          hf_model_url: HF_MODEL_URL,
          instructions: [
            '1. Get Hugging Face token from https://huggingface.co/settings/tokens',
            '2. Add HF_TOKEN to Railway environment variables',
            '3. Restart your backend service'
          ],
          alternative: 'Or configure OpenAI: USE_OPENAI=true and OPENAI_API_KEY=sk-...'
        }
      });
    }

    // Generate advice
    const startTime = Date.now();
    const advice = await generateAdviceWithLLM(
      disease, 
      symptoms, 
      severity, 
      duration, 
      confidence
    );
    const generationTime = Date.now() - startTime;

    console.log(`✅ Advice generated in ${(generationTime / 1000).toFixed(2)}s`);

    // Update prediction with advice
    if (predictionId) {
      try {
        await Prediction.findByIdAndUpdate(predictionId, { 
          advice,
          adviceGeneratedAt: new Date()
        });
      } catch (updateError) {
        console.error('Failed to update prediction:', updateError.message);
      }
    }

    res.json({
      success: true,
      advice,
      metadata: {
        llm_service: USE_OPENAI ? 'OpenAI' : 'Hugging Face',
        model: USE_OPENAI ? 'gpt-3.5-turbo' : 'TinyLlama-1.1B',
        generation_time_ms: generationTime,
        generated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ LLM advice error:', error.message);
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate advice',
      error: error.message
    });
  }
}

// Register routes
async function adviceGetWrapper(req, res, next) {
  try {
    req.body = Object.assign({}, req.body || {}, req.query || {});
    return await adviceHandler(req, res, next);
  } catch (e) {
    next(e);
  }
}

if (ALLOW_PUBLIC_LLM) {
  console.log('⚠️ ALLOW_PUBLIC_LLM is enabled - /api/llm/advice is public');
  router.get('/advice', adviceGetWrapper);
  router.post('/advice', adviceHandler);
} else {
  router.get('/advice', authMiddleware, adviceGetWrapper);
  router.post('/advice', authMiddleware, adviceHandler);
}

// @route   GET /api/llm/health
// @desc    Check LLM service health
// @access  Public
router.get('/health', async (req, res) => {
  const isHealthy = await checkHuggingFaceHealth();
  
  res.json({
    success: true,
    status: {
      huggingface: {
        available: isHealthy,
        model_url: HF_MODEL_URL,
        token_set: !!HF_TOKEN,
        last_check: lastHealthCheck?.toISOString() || null
      },
      openai: {
        configured: !!OPENAI_API_KEY,
        enabled: USE_OPENAI,
        model: 'gpt-3.5-turbo'
      },
      active_service: USE_OPENAI ? 'OpenAI' : (isHealthy ? 'Hugging Face' : 'None')
    }
  });
});

// @route   GET /api/llm/debug
// @desc    Debug endpoint
// @access  Public
router.get('/debug', async (req, res) => {
  try {
    const sample = {
      disease: 'Acne',
      symptoms: 'Multiple comedones',
      severity: 'moderate',
      duration: '2 months',
      confidence: 0.78
    };

    const isHealthy = await checkHuggingFaceHealth();
    
    if ((USE_OPENAI && OPENAI_API_KEY) || (isHealthy && HF_TOKEN)) {
      try {
        console.log('🔍 Debug: Attempting to generate advice...');
        const startTime = Date.now();
        const advice = await generateAdviceWithLLM(
          sample.disease, 
          sample.symptoms, 
          sample.severity, 
          sample.duration, 
          sample.confidence
        );
        const genTime = Date.now() - startTime;
        
        return res.json({ 
          success: true,
          message: 'LLM is working correctly!',
          generation_time: `${(genTime/1000).toFixed(2)}s`,
          sample_data: sample,
          advice_preview: advice.substring(0, 300) + '...',
          full_advice: advice,
          service: USE_OPENAI ? 'OpenAI' : 'Hugging Face',
          model: USE_OPENAI ? 'gpt-3.5-turbo' : 'TinyLlama'
        });
      } catch (err) {
        console.error('Debug generation failed:', err.message);
        return res.status(500).json({ 
          success: false,
          message: 'LLM service available but generation failed',
          error: err.message,
          sample_data: sample
        });
      }
    }

    res.json({ 
      success: false,
      message: 'No LLM service available',
      hf_token_set: !!HF_TOKEN,
      hf_available: isHealthy,
      openai_configured: !!OPENAI_API_KEY,
      instructions: [
        '1. Set HF_TOKEN in Railway variables',
        '2. Get token from https://huggingface.co/settings/tokens',
        '3. Restart backend'
      ]
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
