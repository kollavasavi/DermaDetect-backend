const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

// Try to import models/middleware
let Prediction, authMiddleware;
try {
  Prediction = require('../models/Prediction');
  authMiddleware = require('../middleware/auth');
} catch (err) {
  console.warn('⚠️ Missing models:', err.message);
}

// ============================================================
// CONFIGURATION
// ============================================================
const ML_MODEL_URL = process.env.PREDICTION_MODEL_URL || process.env.ML_MODEL_URL;
const CONFIDENCE_THRESHOLD = 0.15;

const VALID_DISEASES = [
  'acne',
  'hyperpigmentation',
  'vitiligo',
  'sjs',
  'melanoma',
  'keratosis',
  'psoriasis',
  'ringworm'
];

console.log('🔧 ML_MODEL_URL:', ML_MODEL_URL);

// ============================================================
// MULTER CONFIG
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'), false);
    }
  }
});

// ============================================================
// OPTIONAL AUTH
// ============================================================
const optionalAuth = (req, res, next) => {
  if (!authMiddleware) {
    req.user = { _id: 'guest' };
    return next();
  }
  return authMiddleware(req, res, next);
};

// ============================================================
// HELPERS
// ============================================================
function normalizeDiseaseName(disease) {
  return disease.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isValidDisease(disease) {
  const normalized = normalizeDiseaseName(disease);
  return VALID_DISEASES.some(valid => 
    normalizeDiseaseName(valid) === normalized ||
    normalized.includes(normalizeDiseaseName(valid))
  );
}

function determineSeverity(confidence) {
  if (confidence >= 0.7) return 'severe';
  if (confidence >= 0.4) return 'moderate';
  return 'mild';
}

// ============================================================
// TEST ENDPOINTS
// ============================================================
router.get('/test', (req, res) => {
  res.json({ 
    success: true,
    message: '✅ Predict route working',
    mlModelUrl: ML_MODEL_URL,
    configured: !!ML_MODEL_URL
  });
});

router.get('/test-ml', async (req, res) => {
  if (!ML_MODEL_URL) {
    return res.json({
      success: false,
      message: 'ML_MODEL_URL not configured'
    });
  }

  try {
    // Try the health endpoint first
    let testUrl = ML_MODEL_URL;
    if (!testUrl.includes('/predict')) {
      testUrl += '/predict';
    }
    
    const response = await axios.get(testUrl.replace('/predict', '/health'), { 
      timeout: 10000 
    });
    
    res.json({
      success: true,
      mlModelUrl: ML_MODEL_URL,
      healthCheck: response.data
    });
  } catch (error) {
    res.json({
      success: false,
      mlModelUrl: ML_MODEL_URL,
      error: error.message,
      suggestion: 'Make sure your HuggingFace Space is running'
    });
  }
});

// ============================================================
// MAIN PREDICTION ENDPOINT
// ============================================================
router.post('/', optionalAuth, upload.single('image'), async (req, res) => {
  try {
    console.log('📸 Prediction request');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No image uploaded' 
      });
    }

    console.log('📋 File:', req.file.originalname, `${(req.file.size / 1024).toFixed(2)}KB`);

    // Check ML URL
    if (!ML_MODEL_URL) {
      return res.status(500).json({
        success: false,
        message: 'ML Model not configured. Set PREDICTION_MODEL_URL in Railway.'
      });
    }

    // Build correct URL
    let predictionUrl = ML_MODEL_URL;
    if (!predictionUrl.includes('/predict')) {
      predictionUrl += '/predict';
    }

    console.log('🚀 Sending to:', predictionUrl);

    // Prepare form data
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Send to ML model
    let response;
    try {
      response = await axios.post(predictionUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
        maxBodyLength: Infinity
      });
    } catch (mlError) {
      console.error('❌ ML Error:', mlError.message);
      
      if (mlError.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          message: 'Cannot connect to ML model',
          details: 'HuggingFace Space may be sleeping. Try again in 30 seconds.',
          mlUrl: predictionUrl
        });
      }

      if (mlError.code === 'ETIMEDOUT') {
        return res.status(504).json({
          success: false,
          message: 'ML model timeout',
          details: 'Request took too long. Try again.'
        });
      }

      if (mlError.response) {
        return res.status(mlError.response.status).json({
          success: false,
          message: 'ML model error',
          details: mlError.response.data
        });
      }

      throw mlError;
    }

    console.log('✅ ML Response:', JSON.stringify(response.data).substring(0, 200));

    // Extract prediction
    let disease = response.data.predicted_class || 
                  response.data.prediction || 
                  response.data.disease ||
                  response.data.class;
    
    let confidence = parseFloat(response.data.confidence || 0);

    if (!disease) {
      return res.status(500).json({
        success: false,
        message: 'Invalid ML response',
        rawResponse: response.data
      });
    }

    disease = disease.trim();
    console.log(`🔍 Result: "${disease}" (${(confidence * 100).toFixed(1)}%)`);

    // Validate confidence
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.warn(`⚠️ Low confidence: ${(confidence * 100).toFixed(1)}%`);
      return res.status(200).json({
        success: false,
        message: `Confidence too low (${(confidence * 100).toFixed(1)}%).\n\nTips:\n• Better lighting\n• Clearer photo\n• Closer view\n• Consult a dermatologist`,
        confidence: confidence,
        predictedDisease: disease,
        belowThreshold: true
      });
    }

    // Validate disease class
    if (!isValidDisease(disease)) {
      console.warn(`⚠️ Invalid disease: "${disease}"`);
      return res.status(200).json({
        success: false,
        message: `"${disease}" not in trained database.\n\nTrained: ${VALID_DISEASES.join(', ')}\n\nConsult a dermatologist.`,
        detectedClass: disease,
        confidence: confidence,
        invalidClass: true
      });
    }

    // Determine severity
    const severity = determineSeverity(confidence);

    // Save to DB (if available)
    let predictionId = null;
    if (Prediction && req.user && req.user._id !== 'guest') {
      try {
        const prediction = new Prediction({
          userId: req.user._id,
          disease: disease,
          confidence: confidence,
          severity: severity,
          imageUrl: req.file.originalname,
          metadata: {
            symptoms: req.body.symptoms || "",
            duration: req.body.duration || "",
            spreading: req.body.spreading === 'true',
          }
        });

        await prediction.save();
        predictionId = prediction._id;
        console.log('✅ Saved:', predictionId);
      } catch (dbError) {
        console.error('⚠️ DB Error:', dbError.message);
      }
    }

    // Return success
    res.json({
      success: true,
      prediction: disease,
      confidence: confidence,
      severity: severity,
      predictionId: predictionId,
      description: `Detected: ${disease} (${(confidence * 100).toFixed(1)}% confidence)`,
      recommendations: [
        'Monitor the condition',
        'Keep area clean',
        'Avoid scratching',
        'Consult a dermatologist'
      ]
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    
    res.status(500).json({ 
      success: false,
      message: 'Prediction failed',
      error: error.message
    });
  }
});

// ============================================================
// HISTORY ROUTES (if models exist)
// ============================================================
if (Prediction && authMiddleware) {
  router.get('/history', authMiddleware, async (req, res) => {
    try {
      const predictions = await Prediction.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .limit(50);

      res.json({
        success: true,
        predictions: predictions
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch history',
        error: error.message
      });
    }
  });

  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      const prediction = await Prediction.findOne({
        _id: req.params.id,
        userId: req.user._id
      });

      if (!prediction) {
        return res.status(404).json({
          success: false,
          message: 'Not found'
        });
      }

      res.json({
        success: true,
        prediction: prediction
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      const prediction = await Prediction.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id
      });

      if (!prediction) {
        return res.status(404).json({
          success: false,
          message: 'Not found'
        });
      }

      res.json({
        success: true,
        message: 'Deleted'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
}

module.exports = router;
```

## Key Fixes:

1. **✅ Handles ML URL correctly** - Adds `/predict` if missing
2. **✅ Better error messages** - Shows exactly what failed
3. **✅ HuggingFace Space handling** - Detects when space is sleeping
4. **✅ Works without auth** - For testing
5. **✅ Confidence threshold** - Rejects low predictions
6. **✅ Disease validation** - Only allows trained classes

## Next Steps:

1. **Update Railway Variable:**
```
   PREDICTION_MODEL_URL=https://vasavi07-dermadetect-ml-model.hf.space
