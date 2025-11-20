// routes/llm.js - Enhanced LLM Integration with Timeout Handling
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Prediction = require('../models/Prediction');
const authMiddleware = require('../middleware/auth');

// Configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const LLM_MODEL = process.env.LLM_MODEL || 'phi3:mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const USE_OPENAI = process.env.USE_OPENAI === 'true';

// Timeout configuration (in milliseconds)
const GENERATION_TIMEOUT = parseInt(process.env.LLM_TIMEOUT) || 120000; // 2 minutes default
const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds

// Health check state
let ollamaAvailable = false;
let lastHealthCheck = null;
let availableModels = [];

// Enhanced health check with better error reporting
async function checkOllamaHealth() {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, { 
      timeout: HEALTH_CHECK_TIMEOUT,
      validateStatus: (status) => status < 500
    });
    
    if (response.status !== 200) {
      ollamaAvailable = false;
      return false;
    }
    
    ollamaAvailable = true;
    lastHealthCheck = new Date();
    availableModels = response.data.models || [];
    
    // Check if requested model is available
    const hasModel = availableModels.some(m => 
      m.name === LLM_MODEL || m.name.startsWith(LLM_MODEL.split(':')[0])
    );
    
    if (hasModel) {
      console.log(`✅ Ollama ready with model: ${LLM_MODEL}`);
    } else {
      console.log(`⚠️ Ollama running but model '${LLM_MODEL}' not found`);
      console.log(`📦 Available models:`, availableModels.map(m => m.name).join(', '));
      console.log(`💡 Install model: ollama pull ${LLM_MODEL}`);
      ollamaAvailable = false;
    }
    
    return hasModel;
  } catch (error) {
    ollamaAvailable = false;
    
    if (error.code === 'ECONNREFUSED') {
      console.log('⚠️ Cannot connect to Ollama - is it running?');
      console.log('💡 Start Ollama: ollama serve');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('⚠️ Ollama connection timeout');
    } else {
      console.log('⚠️ Ollama health check failed:', error.message);
    }
    
    return false;
  }
}

// Initialize health check on startup
checkOllamaHealth();

// Generate advice using LLM
async function generateAdviceWithLLM(disease, symptoms, severity, duration, confidence) {
  // Option 1: OpenAI
  if (USE_OPENAI && OPENAI_API_KEY) {
    return await generateWithOpenAI(disease, symptoms, severity, duration, confidence);
  }
  
  // Option 2: Ollama
  if (ollamaAvailable) {
    return await generateWithOllama(disease, symptoms, severity, duration, confidence);
  }
  
  // No LLM available
  throw new Error(
    `No LLM service available. ` +
    `Please install Ollama (https://ollama.ai) and run: ollama pull tinyllama`
  );
}

// OpenAI Integration with enhanced error handling
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

// Ollama Integration with aggressive optimization for slow systems
async function generateWithOllama(disease, symptoms, severity, duration, confidence) {
  try {
    const prompt = createMedicalPrompt(disease, symptoms, severity, duration, confidence);
    
    console.log(`🤖 Generating advice with Ollama (${LLM_MODEL})...`);
    console.log(`⏱️ Timeout set to ${GENERATION_TIMEOUT/1000} seconds`);

    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: LLM_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          num_predict: 600,       // Reduced for faster generation
          num_ctx: 1024,          // Reduced context window (was 2048)
          repeat_penalty: 1.1,
          num_thread: 4,          // Limit threads for stability
          num_gpu: 0,             // Force CPU (more stable on low-end systems)
          stop: ['\n\n\n', 'User:', 'Question:']
        }
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: GENERATION_TIMEOUT,
        validateStatus: (status) => status < 500
      }
    );

    if (!response.data?.response) {
      throw new Error('Empty response from Ollama');
    }

    console.log(`✅ Advice generated successfully (${response.data.response.length} chars)`);
    return response.data.response.trim();
    
  } catch (error) {
    // Enhanced error handling
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Cannot connect to Ollama. Make sure Ollama is running: ollama serve');
    }
    
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      console.error(`❌ Timeout after ${GENERATION_TIMEOUT/1000}s - Model is too slow for your system`);
      throw new Error(
        `Generation timeout (${GENERATION_TIMEOUT/1000}s exceeded). ` +
        `Your current model (${LLM_MODEL}) is too slow for your system. ` +
        `SOLUTION: Switch to tinyllama - it's 10x faster! ` +
        `Run: ollama pull tinyllama, then set LLM_MODEL=tinyllama in .env`
      );
    }
    
    if (error.response?.data?.error) {
      const errorMsg = error.response.data.error;
      
      // Memory issues
      if (errorMsg.includes('memory') || errorMsg.includes('out of memory')) {
        throw new Error(
          `Memory error: Model too large for available RAM. ` +
          `SOLUTION: Use tinyllama instead. Run: ollama pull tinyllama, then set LLM_MODEL=tinyllama in .env`
        );
      }
      
      // Model not found
      if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
        throw new Error(
          `Model '${LLM_MODEL}' not found. Install it with: ollama pull ${LLM_MODEL}`
        );
      }
      
      throw new Error(`Ollama error: ${errorMsg}`);
    }
    
    console.error('Ollama error:', error.message);
    throw new Error(`Ollama error: ${error.message}`);
  }
}

// Create comprehensive but concise medical prompt
function createMedicalPrompt(disease, symptoms, severity, duration, confidence) {
  const urgentConditions = ['melanoma', 'basal cell carcinoma', 'squamous cell carcinoma', 'stevens-johnson syndrome', 'cellulitis', 'sepsis'];
  const isUrgent = urgentConditions.some(cond => disease.toLowerCase().includes(cond));
  
  // Shorter, more focused prompt for faster generation
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
- Keep response under 500 words for speed
- Use simple language
- End with: "⚠️ This is AI-generated advice. Always consult a dermatologist for proper diagnosis."
- ${isUrgent ? 'Emphasize URGENT medical attention needed' : 'Note AI screening is not a diagnosis'}`;
}

// Allow making the advice endpoint public for quick mobile/demo testing
// Set ALLOW_PUBLIC_LLM=true in backend .env to disable auth on /api/llm/advice
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

    console.log(`🔍 Request: Generate advice for ${disease} (Severity: ${severity || 'not specified'})`);

    // Re-check Ollama health if needed
    if (!lastHealthCheck || (Date.now() - lastHealthCheck) > 30000) {
      await checkOllamaHealth();
    }

    // Check LLM availability
    if (!ollamaAvailable && !USE_OPENAI) {
      return res.status(503).json({
        success: false,
        message: 'LLM service not available',
        details: {
          ollama_url: OLLAMA_URL,
          expected_model: LLM_MODEL,
          available_models: availableModels.map(m => m.name),
          instructions: [
            '1. Install Ollama from https://ollama.ai',
            '2. Pull a FAST model: ollama pull tinyllama',
            '3. Update .env: LLM_MODEL=tinyllama',
            '4. Restart your server'
          ],
          alternative: 'Or configure OpenAI in .env: USE_OPENAI=true and OPENAI_API_KEY=sk-...'
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
        // Don't fail the request if update fails
      }
    }

    res.json({
      success: true,
      advice,
      metadata: {
        llm_service: USE_OPENAI ? 'OpenAI' : 'Ollama',
        model: USE_OPENAI ? 'gpt-3.5-turbo' : LLM_MODEL,
        generation_time_ms: generationTime,
        generated_at: new Date().toISOString(),
        timeout_configured: `${GENERATION_TIMEOUT/1000}s`
      }
    });

  } catch (error) {
    console.error('❌ LLM advice error:', error.message);
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate advice',
      error: error.message,
      suggestion: getSuggestionForError(error),
      quick_fix: error.message.includes('timeout') ? {
        problem: 'Model is too slow for your system',
        solution: 'Switch to tinyllama (10x faster)',
        commands: [
          'ollama pull tinyllama',
          'Update .env: LLM_MODEL=tinyllama',
          'Restart server'
        ]
      } : null
    });
  }
}

// Register route with or without auth depending on ALLOW_PUBLIC_LLM
// Support GET /advice for clients that call the endpoint with query params
async function adviceGetWrapper(req, res, next) {
  try {
    // populate body from query so adviceHandler can read parameters
    req.body = Object.assign({}, req.body || {}, req.query || {});
    return await adviceHandler(req, res, next);
  } catch (e) {
    next(e);
  }
}

if (ALLOW_PUBLIC_LLM) {
  console.log('⚠️ ALLOW_PUBLIC_LLM is enabled - /api/llm/advice is public (no auth)');
  router.get('/advice', adviceGetWrapper);
  router.post('/advice', adviceHandler);
} else {
  router.get('/advice', authMiddleware, adviceGetWrapper);
  router.post('/advice', authMiddleware, adviceHandler);
}

// @route   POST /api/llm/chat
// @desc    Interactive chat with LLM
// @access  Private
router.post('/chat', authMiddleware, async (req, res) => {
  try {
    const { message, disease, conversationHistory } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Message is required' 
      });
    }

    // Build conversation context
    let contextMessages = '';
    if (conversationHistory && Array.isArray(conversationHistory)) {
      contextMessages = conversationHistory
        .slice(-5)  // Keep last 5 messages for context
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
    }

    // Shorter prompt for chat
    const chatPrompt = `Medical assistant for dermatology. ${disease ? `Patient has: ${disease}` : ''}

${contextMessages ? `Recent chat:\n${contextMessages}\n` : ''}
Question: ${message}

Provide a brief, helpful answer (2-3 sentences). If serious, recommend seeing a doctor.`;

    // Re-check health
    if (!lastHealthCheck || (Date.now() - lastHealthCheck) > 30000) {
      await checkOllamaHealth();
    }

    let response;
    
    if (USE_OPENAI && OPENAI_API_KEY) {
      const result = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a medical assistant specializing in dermatology. Be helpful, accurate, and empathetic.' },
            { role: 'user', content: chatPrompt }
          ],
          temperature: 0.8,
          max_tokens: 300
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000
        }
      );
      response = result.data.choices[0].message.content;
      
    } else if (ollamaAvailable) {
      const result = await axios.post(
        `${OLLAMA_URL}/api/generate`,
        {
          model: LLM_MODEL,
          prompt: chatPrompt,
          stream: false,
          options: {
            temperature: 0.8,
            num_predict: 200,  // Reduced for faster chat
            num_ctx: 1024,     // Reduced context
            num_thread: 4
          }
        },
        {
          timeout: 60000  // 1 minute for chat
        }
      );
      response = result.data.response.trim();
      
    } else {
      throw new Error('No LLM service available');
    }

    res.json({
      success: true,
      response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process chat message',
      error: error.message,
      suggestion: error.message.includes('timeout') ? 
        'Chat timed out. Consider using tinyllama for faster responses.' : 
        'Check if LLM service is available'
    });
  }
});

// @route   GET /api/llm/health
// @desc    Check LLM service health
// @access  Public
router.get('/health', async (req, res) => {
  const isHealthy = await checkOllamaHealth();
  
  res.json({
    success: true,
    status: {
      ollama: {
        available: isHealthy,
        url: OLLAMA_URL,
        model: LLM_MODEL,
        available_models: availableModels.map(m => m.name),
        last_check: lastHealthCheck?.toISOString() || null,
        timeout: `${GENERATION_TIMEOUT/1000}s`
      },
      openai: {
        configured: !!OPENAI_API_KEY,
        enabled: USE_OPENAI,
        model: 'gpt-3.5-turbo'
      },
      active_service: USE_OPENAI ? 'OpenAI' : (isHealthy ? 'Ollama' : 'None')
    },
    performance_tips: !isHealthy && !USE_OPENAI ? [
      'For slow systems, use tinyllama (1GB, very fast)',
      'Command: ollama pull tinyllama',
      'Update .env: LLM_MODEL=tinyllama'
    ] : isHealthy && LLM_MODEL !== 'tinyllama' ? [
      `Current model: ${LLM_MODEL}`,
      'If experiencing timeouts, switch to tinyllama for 10x faster generation'
    ] : []
  });
});

// @route   GET /api/llm/debug
// @desc    Debug endpoint with sample request
// @access  Public
router.get('/debug', async (req, res) => {
  try {
    const sample = {
      disease: 'Acne',
      symptoms: 'Multiple comedones, papules, and pustules on face',
      severity: 'moderate',
      duration: '2 months',
      confidence: 0.78
    };

    const isHealthy = await checkOllamaHealth();
    const prompt = createMedicalPrompt(
      sample.disease, 
      sample.symptoms, 
      sample.severity, 
      sample.duration, 
      sample.confidence
    );

    // Try to generate actual advice if LLM is available
    if ((USE_OPENAI && OPENAI_API_KEY) || isHealthy) {
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
          prompt_length: prompt.length,
          advice_preview: advice.substring(0, 300) + '...',
          full_advice: advice,
          service: USE_OPENAI ? 'OpenAI' : 'Ollama',
          model: USE_OPENAI ? 'gpt-3.5-turbo' : LLM_MODEL,
          performance: genTime > 60000 ? 'SLOW - Consider switching to tinyllama' : 'OK'
        });
      } catch (err) {
        console.error('Debug generation failed:', err.message);
        return res.status(500).json({ 
          success: false,
          message: 'LLM service available but generation failed',
          error: err.message,
          sample_data: sample,
          prompt_length: prompt.length,
          suggestion: getSuggestionForError(err)
        });
      }
    }

    // No LLM available
    res.json({ 
      success: false,
      message: 'No LLM service available - showing prompt only',
      sample_data: sample,
      prompt: prompt,
      prompt_length: prompt.length,
      ollama_available: isHealthy,
      openai_configured: !!OPENAI_API_KEY,
      instructions: [
        'For FAST generation: ollama pull tinyllama',
        'Update .env: LLM_MODEL=tinyllama',
        'Or configure OpenAI in .env'
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

// @route   GET /api/llm/models
// @desc    List available models with performance ratings
// @access  Public
router.get('/models', async (req, res) => {
  try {
    await checkOllamaHealth();
    
    if (ollamaAvailable) {
      const response = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
      const models = response.data.models || [];
      
      // Performance ratings
      const modelPerformance = {
        'tinyllama': { speed: '⚡⚡⚡ Very Fast', ram: '1GB', quality: '⭐⭐ Basic' },
        'phi3:mini': { speed: '⚡⚡ Moderate', ram: '2.3GB', quality: '⭐⭐⭐ Good' },
        'gemma:2b': { speed: '⚡⚡ Moderate', ram: '1.7GB', quality: '⭐⭐⭐ Good' },
        'llama3:8b': { speed: '⚡ Slow', ram: '4.7GB', quality: '⭐⭐⭐⭐ Excellent' }
      };
      
      res.json({
        success: true,
        service: 'Ollama',
        current_model: LLM_MODEL,
        timeout_setting: `${GENERATION_TIMEOUT/1000}s`,
        available_models: models.map(m => ({
          name: m.name,
          size: `${(m.size / (1024**3)).toFixed(2)} GB`,
          performance: modelPerformance[m.name] || { speed: 'Unknown', ram: 'Unknown', quality: 'Unknown' },
          recommended_for: m.name === 'tinyllama' ? 'Low RAM / Fast generation' :
                          m.name === 'phi3:mini' ? 'Balanced quality & speed' :
                          m.name === 'llama3:8b' ? 'Best quality (requires good hardware)' : null
        })),
        recommendation: LLM_MODEL === 'phi3:mini' ? 
          '💡 Experiencing timeouts? Switch to tinyllama for 10x faster generation' :
          LLM_MODEL === 'tinyllama' ?
          '✅ You are using the fastest model' :
          '💡 For faster generation, try tinyllama'
      });
    } else if (USE_OPENAI) {
      res.json({
        success: true,
        service: 'OpenAI',
        current_model: 'gpt-3.5-turbo',
        available_models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo']
      });
    } else {
      res.json({
        success: false,
        message: 'No LLM service available',
        instructions: [
          'Recommended: ollama pull tinyllama (fastest, 1GB)',
          'Update .env: LLM_MODEL=tinyllama',
          'Or: Set USE_OPENAI=true with OPENAI_API_KEY'
        ]
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to provide context-aware suggestions
function getSuggestionForError(error) {
  const msg = error.message.toLowerCase();
  
  if (msg.includes('timeout')) {
    return `⚡ TIMEOUT: Your model (${LLM_MODEL}) is too slow! Switch to tinyllama:\n` +
           `1. ollama pull tinyllama\n` +
           `2. Update .env: LLM_MODEL=tinyllama\n` +
           `3. Restart server\n` +
           `Tinyllama is 10x faster and works great for medical advice!`;
  }
  
  if (msg.includes('memory') || msg.includes('out of memory')) {
    return 'Memory error! Switch to tinyllama (only 1GB): ollama pull tinyllama, then set LLM_MODEL=tinyllama in .env';
  }
  
  if (msg.includes('not found') || msg.includes('does not exist')) {
    return `Model not found! Run: ollama pull ${LLM_MODEL === 'phi3:mini' ? 'tinyllama (recommended)' : LLM_MODEL}`;
  }
  
  if (msg.includes('connect') || msg.includes('econnrefused')) {
    return 'Cannot connect to Ollama. Make sure it is running: ollama serve';
  }
  
  if (msg.includes('api key') || msg.includes('unauthorized')) {
    return 'Invalid OpenAI API key. Check your .env file';
  }
  
  return 'Try switching to tinyllama for better performance: ollama pull tinyllama';
}

module.exports = router;