const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

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

// Main prediction endpoint
router.post('/', optionalAuth, upload.single('image'), async function(req, res) {
  console.log('=== PREDICTION REQUEST START ===');
  
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

  console.log('File:', req.file.originalname, '(' + req.file.size + ' bytes)');
  console.log('MIME:', req.file.mimetype);
  console.log('URL:', predictionUrl);

  try {
    // ✅ THE CORRECT WAY - Append buffer with proper options for Flask
    const formData = new FormData();
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      knownLength: req.file.size
    });

    // Add optional fields if present
    if (req.body.symptoms) {
      formData.append('symptoms', req.body.symptoms);
    }
    if (req.body.duration) {
      formData.append('duration', req.body.duration);
    }
    if (req.body.severity) {
      formData.append('severity', req.body.severity);
    }

    console.log('Sending request to ML model...');

    const response = await axios.post(predictionUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 120000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    console.log('Response Status:', response.status);
    console.log('Response Data:', JSON.stringify(response.data, null, 2));

    // Check for success field in response
    if (response.data.success === false) {
      return res.status(400).json({
        success: false,
        message: response.data.error || 'ML model returned an error',
        mlError: response.data
      });
    }

    // Extract prediction data
    let disease = response.data.prediction || response.data.predicted_class || response.data.disease;
    let confidence = parseFloat(response.data.confidence || 0);

    // Convert percentage to decimal if needed
    if (confidence > 1) {
      confidence = confidence / 100;
    }

    if (!disease) {
      return res.status(500).json({
        success: false,
        message: 'No disease prediction in response',
        rawResponse: response.data
      });
    }

    disease = disease.trim();
    console.log('✅ Prediction:', disease, '| Confidence:', confidence);

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

    // Return successful prediction
    return res.json({
      success: true,
      prediction: disease,
      confidence: confidence,
      severity: severity,
      description: response.data.description || 'Detected: ' + disease,
      recommendations: response.data.recommendations || [
        'Consult a dermatologist for proper diagnosis',
        'Monitor the condition closely',
        'Keep the affected area clean',
        'Avoid scratching or irritating the area'
      ],
      allPredictions: response.data.all_predictions || null,
      modelDetails: response.data.model_details || null
    });

  } catch (mlError) {
    console.error('=== ML MODEL ERROR ===');
    console.error('Error:', mlError.message);
    console.error('Code:', mlError.code);
    
    // Handle specific error responses from Flask
    if (mlError.response) {
      console.error('Status:', mlError.response.status);
      console.error('Data:', mlError.response.data);
      
      if (mlError.response.status === 400) {
        return res.status(400).json({
          success: false,
          message: 'ML model rejected the image',
          error: mlError.response.data.error || mlError.response.data,
          hint: 'The image format may be incompatible. Try a different image.'
        });
      }
      
      if (mlError.response.status === 500) {
        return res.status(500).json({
          success: false,
          message: 'ML model internal error',
          error: mlError.response.data.error || mlError.response.data
        });
      }
    }
    
    // Handle connection errors
    if (mlError.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        message: 'Cannot connect to ML model',
        details: 'HuggingFace Space may be sleeping',
        hint: 'Visit https://huggingface.co/spaces/vasavi07/dermadetect-ml-model to wake it up'
      });
    }

    if (mlError.code === 'ETIMEDOUT') {
      return res.status(504).json({
        success: false,
        message: 'ML model timeout',
        hint: 'The model took too long to respond'
      });
    }

    // Generic error
    return res.status(500).json({ 
      success: false,
      message: 'Request failed',
      error: mlError.message
    });
  }
});

module.exports = router;
