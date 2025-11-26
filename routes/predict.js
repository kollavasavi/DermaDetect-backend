const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const stream = require('stream');

// Models/Middleware (optional)
let Prediction = null;
let authMiddleware = null;

try {
  Prediction = require('../models/Prediction');
} catch (err) {
  console.warn('Prediction model not found');
}

try {
  authMiddleware = require('../middleware/auth');
} catch (err) {
  console.warn('Auth middleware not found');
}

// Config
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

console.log('ML Model URL configured:', ML_MODEL_URL ? 'Yes' : 'No');

// Multer setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 10 * 1024 * 1024 
  },
  fileFilter: function(req, file, callback) {
    if (file.mimetype.startsWith('image/')) {
      callback(null, true);
    } else {
      callback(new Error('Only images allowed'), false);
    }
  }
});

// Optional auth middleware
function optionalAuth(req, res, next) {
  if (!authMiddleware) {
    req.user = { _id: 'guest' };
    return next();
  }
  return authMiddleware(req, res, next);
}

// Helper functions
function normalizeDiseaseName(disease) {
  return disease.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isValidDisease(disease) {
  const normalized = normalizeDiseaseName(disease);
  let i = 0;
  while (i < VALID_DISEASES.length) {
    const valid = VALID_DISEASES[i];
    const normalizedValid = normalizeDiseaseName(valid);
    if (normalizedValid === normalized || normalized.includes(normalizedValid)) {
      return true;
    }
    i = i + 1;
  }
  return false;
}

function determineSeverity(confidence) {
  if (confidence >= 0.7) {
    return 'severe';
  }
  if (confidence >= 0.4) {
    return 'moderate';
  }
  return 'mild';
}

// Test endpoint
router.get('/test', function(req, res) {
  return res.json({ 
    success: true,
    message: 'Predict route working',
    mlModelUrl: ML_MODEL_URL || 'Not configured',
    configured: ML_MODEL_URL ? true : false
  });
});

// ML test endpoint
router.get('/test-ml', function(req, res) {
  if (!ML_MODEL_URL) {
    return res.json({
      success: false,
      message: 'ML_MODEL_URL not configured'
    });
  }

  let testUrl = ML_MODEL_URL;
  if (testUrl.includes('/predict') === false) {
    testUrl = testUrl + '/predict';
  }
  
  axios.get(testUrl.replace('/predict', '/health'), { 
    timeout: 10000 
  })
  .then(function(response) {
    return res.json({
      success: true,
      mlModelUrl: ML_MODEL_URL,
      healthCheck: response.data
    });
  })
  .catch(function(error) {
    return res.json({
      success: false,
      mlModelUrl: ML_MODEL_URL,
      error: error.message
    });
  });
});

// Main prediction endpoint - FIXED VERSION
router.post('/', optionalAuth, upload.single('image'), function(req, res) {
  console.log('=== PREDICTION REQUEST START ===');
  console.log('File received:', req.file ? req.file.originalname : 'NONE');
  
  if (!req.file) {
    return res.status(400).json({ 
      success: false,
      message: 'No image uploaded' 
    });
  }

  if (!ML_MODEL_URL) {
    return res.status(500).json({
      success: false,
      message: 'ML Model not configured'
    });
  }

  let predictionUrl = ML_MODEL_URL;
  if (!predictionUrl.includes('/predict')) {
    predictionUrl = predictionUrl + '/predict';
  }

  console.log('Target URL:', predictionUrl);
  console.log('File size:', req.file.size);
  console.log('File type:', req.file.mimetype);

  // ✅ CRITICAL FIX: Create a readable stream from buffer
  // This is the proper way to send buffers in multipart form-data
  const bufferStream = new stream.PassThrough();
  bufferStream.end(req.file.buffer);

  // Create FormData with the stream
  const formData = new FormData();
  formData.append('image', bufferStream, {
    filename: req.file.originalname,
    contentType: req.file.mimetype
  });

  console.log('FormData created with PassThrough stream');

  axios.post(predictionUrl, formData, {
    headers: formData.getHeaders(),
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  })
  .then(function(response) {
    console.log('=== ML RESPONSE SUCCESS ===');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data));

    let disease = response.data.prediction || response.data.predicted_class || response.data.disease;
    let confidence = parseFloat(response.data.confidence || 0);

    // Convert confidence from percentage to decimal if needed
    if (confidence > 1) {
      confidence = confidence / 100;
    }

    if (!disease) {
      console.error('No disease found in response');
      return res.status(500).json({
        success: false,
        message: 'Invalid ML response - no disease prediction',
        rawResponse: response.data
      });
    }

    disease = disease.trim();
    console.log('Detected:', disease, 'Confidence:', confidence);

    if (confidence < CONFIDENCE_THRESHOLD) {
      return res.json({
        success: false,
        message: 'Confidence too low',
        confidence: confidence,
        predictedDisease: disease,
        belowThreshold: true
      });
    }

    if (!isValidDisease(disease)) {
      return res.json({
        success: false,
        message: 'Disease not in trained database',
        detectedClass: disease,
        confidence: confidence,
        invalidClass: true
      });
    }

    const severity = determineSeverity(confidence);
    let predictionId = null;

    // Save to database if available
    if (Prediction && req.user && req.user._id !== 'guest') {
      const newPrediction = new Prediction({
        userId: req.user._id,
        disease: disease,
        confidence: confidence,
        severity: severity,
        imageUrl: req.file.originalname,
        metadata: {
          symptoms: req.body.symptoms || '',
          duration: req.body.duration || '',
          spreading: req.body.spreading === 'true'
        }
      });

      newPrediction.save()
        .then(function(saved) {
          predictionId = saved._id;
          console.log('Prediction saved:', predictionId);
        })
        .catch(function(dbError) {
          console.error('DB Error:', dbError.message);
        });
    }

    return res.json({
      success: true,
      prediction: disease,
      confidence: confidence,
      severity: severity,
      predictionId: predictionId,
      description: response.data.description || 'Detected: ' + disease,
      recommendations: response.data.recommendations || [
        'Consult a dermatologist for proper diagnosis',
        'Monitor the condition closely',
        'Keep the affected area clean and dry',
        'Avoid scratching or touching the area'
      ],
      allPredictions: response.data.all_predictions || null,
      modelDetails: response.data.model_details || null
    });
  })
  .catch(function(mlError) {
    console.error('=== ML ERROR ===');
    console.error('Message:', mlError.message);
    console.error('Code:', mlError.code);
    
    if (mlError.response) {
      console.error('Status:', mlError.response.status);
      console.error('Response:', JSON.stringify(mlError.response.data));
      
      return res.status(mlError.response.status).json({
        success: false,
        message: 'ML model error',
        statusCode: mlError.response.status,
        error: mlError.response.data,
        hint: mlError.response.status === 400 ? 
          'The ML model rejected the image format. Please ensure the image is valid.' : null
      });
    }

    if (mlError.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        message: 'Cannot connect to ML model',
        details: 'HuggingFace Space may be sleeping. Visit the space URL to wake it up.',
        spaceUrl: 'https://vasavi07-dermadetect-ml-model.hf.space'
      });
    }

    if (mlError.code === 'ETIMEDOUT') {
      return res.status(504).json({
        success: false,
        message: 'ML model timeout',
        details: 'Request took longer than 2 minutes'
      });
    }

    return res.status(500).json({ 
      success: false,
      message: 'Prediction failed',
      error: mlError.message
    });
  });
});

// History routes (if models available)
if (Prediction && authMiddleware) {
  router.get('/history', authMiddleware, function(req, res) {
    Prediction.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .then(function(predictions) {
        return res.json({ 
          success: true, 
          predictions: predictions 
        });
      })
      .catch(function(error) {
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to fetch history', 
          error: error.message 
        });
      });
  });

  router.get('/:id', authMiddleware, function(req, res) {
    Prediction.findOne({ 
      _id: req.params.id, 
      userId: req.user._id 
    })
    .then(function(prediction) {
      if (!prediction) {
        return res.status(404).json({ 
          success: false, 
          message: 'Not found' 
        });
      }
      return res.json({ 
        success: true, 
        prediction: prediction 
      });
    })
    .catch(function(error) {
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    });
  });

  router.delete('/:id', authMiddleware, function(req, res) {
    Prediction.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user._id 
    })
    .then(function(prediction) {
      if (!prediction) {
        return res.status(404).json({ 
          success: false, 
          message: 'Not found' 
        });
      }
      return res.json({ 
        success: true, 
        message: 'Deleted' 
      });
    })
    .catch(function(error) {
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    });
  });
}

module.exports = router;
