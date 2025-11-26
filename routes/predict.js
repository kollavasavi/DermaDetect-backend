const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');

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

// DEBUG: Test what the backend receives
router.post('/test-upload', upload.single('image'), function(req, res) {
  console.log('=== TEST UPLOAD DEBUG ===');
  console.log('req.file:', req.file ? 'EXISTS' : 'NULL');
  console.log('req.body:', JSON.stringify(req.body));
  
  if (req.file) {
    console.log('File details:', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });
  }
  
  return res.json({
    success: true,
    receivedFile: req.file ? true : false,
    fileDetails: req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : null,
    bodyFields: Object.keys(req.body)
  });
});

// DEBUG: Test direct ML model connection
router.post('/test-ml-direct', upload.single('image'), function(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file' });
  }
  
  if (!ML_MODEL_URL) {
    return res.status(500).json({ success: false, message: 'ML_MODEL_URL not set' });
  }

  const predictionUrl = ML_MODEL_URL.includes('/predict') ? ML_MODEL_URL : ML_MODEL_URL + '/predict';
  
  console.log('=== DIRECT ML TEST ===');
  console.log('URL:', predictionUrl);
  console.log('File:', req.file.originalname, req.file.size, 'bytes');
  
  // Test with raw buffer
  const formData = new FormData();
  formData.append('image', req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype
  });
  
  axios.post(predictionUrl, formData, {
    headers: formData.getHeaders(),
    timeout: 60000,
    validateStatus: () => true // Don't throw on any status
  })
  .then(function(response) {
    console.log('ML Response Status:', response.status);
    console.log('ML Response Data:', JSON.stringify(response.data));
    
    return res.json({
      success: response.status === 200,
      mlStatus: response.status,
      mlResponse: response.data,
      message: response.status === 200 ? 'ML model working!' : 'ML model returned error'
    });
  })
  .catch(function(error) {
    console.error('ML Error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
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

// Main prediction endpoint - FIXED WITH READABLE STREAM
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
  console.log('File details:');
  console.log('  - Original name:', req.file.originalname);
  console.log('  - Size:', req.file.size, 'bytes');
  console.log('  - MIME type:', req.file.mimetype);
  console.log('  - Buffer length:', req.file.buffer.length);

  // ✅ TRY MULTIPLE APPROACHES - Flask can be picky about multipart data
  
  // Approach 1: Direct buffer with proper metadata (most compatible with Flask)
  const formData = new FormData();
  formData.append('image', req.file.buffer, {
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    knownLength: req.file.size
  });

  console.log('FormData created with direct buffer');
  console.log('FormData headers:', formData.getHeaders());
  console.log('Sending POST request to ML model...');

  // Send the request
  axios({
    method: 'POST',
    url: predictionUrl,
    data: formData,
    headers: {
      ...formData.getHeaders()
    },
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: function(status) {
      return status < 500; // Don't throw on 4xx errors
    }
  })
  .then(function(response) {
    console.log('=== ML RESPONSE RECEIVED ===');
    console.log('Status Code:', response.status);
    console.log('Response Headers:', JSON.stringify(response.headers));
    console.log('Response Data:', JSON.stringify(response.data));

    // Handle non-200 responses
    if (response.status === 400) {
      console.error('400 Bad Request - ML model rejected the request');
      console.error('This usually means the image field was not received correctly');
      return res.status(400).json({
        success: false,
        message: 'ML model rejected the image',
        details: response.data,
        hint: 'The ML model expects multipart/form-data with an "image" field'
      });
    }

    if (response.status !== 200) {
      return res.status(response.status).json({
        success: false,
        message: 'ML model returned error',
        statusCode: response.status,
        details: response.data
      });
    }

    // Parse the successful response
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
    console.log('✅ Detected:', disease, '| Confidence:', confidence);

    // Check confidence threshold
    if (confidence < CONFIDENCE_THRESHOLD) {
      return res.json({
        success: false,
        message: 'Confidence too low',
        confidence: confidence,
        predictedDisease: disease,
        belowThreshold: true
      });
    }

    // Validate disease
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
          console.log('Prediction saved to database:', predictionId);
        })
        .catch(function(dbError) {
          console.error('DB Save Error:', dbError.message);
        });
    }

    // Return successful response
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
        'Avoid scratching or irritating the area',
        'Take photos to track progression'
      ],
      allPredictions: response.data.all_predictions || null,
      modelDetails: response.data.model_details || null
    });
  })
  .catch(function(mlError) {
    console.error('=== ML REQUEST ERROR ===');
    console.error('Error Type:', mlError.code || 'UNKNOWN');
    console.error('Error Message:', mlError.message);
    
    if (mlError.response) {
      console.error('Response Status:', mlError.response.status);
      console.error('Response Data:', JSON.stringify(mlError.response.data));
    }

    // Handle different error types
    if (mlError.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        message: 'Cannot connect to ML model',
        details: 'HuggingFace Space may be sleeping or unavailable',
        spaceUrl: 'https://vasavi07-dermadetect-ml-model.hf.space',
        hint: 'Visit the space URL to wake it up, then try again'
      });
    }

    if (mlError.code === 'ETIMEDOUT') {
      return res.status(504).json({
        success: false,
        message: 'ML model timeout',
        details: 'Request took longer than 2 minutes',
        hint: 'The image might be too large or the model is overloaded'
      });
    }

    if (mlError.code === 'ENOTFOUND') {
      return res.status(503).json({
        success: false,
        message: 'ML model URL not found',
        details: 'Cannot resolve the HuggingFace Space URL',
        configuredUrl: ML_MODEL_URL
      });
    }

    // Generic error
    return res.status(500).json({ 
      success: false,
      message: 'Prediction request failed',
      error: mlError.message,
      code: mlError.code
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
