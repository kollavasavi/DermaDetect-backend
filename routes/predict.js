const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

let Prediction, authMiddleware;
try {
  Prediction = require('../models/Prediction');
  authMiddleware = require('../middleware/auth');
} catch (err) {
  console.warn('Missing models:', err.message);
}

const ML_MODEL_URL = process.env.PREDICTION_MODEL_URL || process.env.ML_MODEL_URL;
const CONFIDENCE_THRESHOLD = 0.15;
const VALID_DISEASES = ['acne', 'hyperpigmentation', 'vitiligo', 'sjs', 'melanoma', 'keratosis', 'psoriasis', 'ringworm'];

console.log('ML_MODEL_URL:', ML_MODEL_URL);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'), false);
    }
  }
});

const optionalAuth = function(req, res, next) {
  if (!authMiddleware) {
    req.user = { _id: 'guest' };
    return next();
  }
  return authMiddleware(req, res, next);
};

function normalizeDiseaseName(disease) {
  return disease.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isValidDisease(disease) {
  const normalized = normalizeDiseaseName(disease);
  return VALID_DISEASES.some(function(valid) {
    return normalizeDiseaseName(valid) === normalized || normalized.includes(normalizeDiseaseName(valid));
  });
}

function determineSeverity(confidence) {
  if (confidence >= 0.7) return 'severe';
  if (confidence >= 0.4) return 'moderate';
  return 'mild';
}

router.get('/test', function(req, res) {
  res.json({ 
    success: true,
    message: 'Predict route working',
    mlModelUrl: ML_MODEL_URL,
    configured: !!ML_MODEL_URL
  });
});

router.get('/test-ml', async function(req, res) {
  if (!ML_MODEL_URL) {
    return res.json({
      success: false,
      message: 'ML_MODEL_URL not configured'
    });
  }

  try {
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
      error: error.message
    });
  }
});

router.post('/', optionalAuth, upload.single('image'), async function(req, res) {
  try {
    console.log('Prediction request');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No image uploaded' 
      });
    }

    console.log('File:', req.file.originalname);

    if (!ML_MODEL_URL) {
      return res.status(500).json({
        success: false,
        message: 'ML Model not configured'
      });
    }

    let predictionUrl = ML_MODEL_URL;
    if (!predictionUrl.includes('/predict')) {
      predictionUrl += '/predict';
    }

    console.log('Sending to:', predictionUrl);

    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    let response;
    try {
      response = await axios.post(predictionUrl, formData, {
        headers: formData.getHeaders(),
        timeout: 120000,
        maxBodyLength: Infinity
      });
    } catch (mlError) {
      console.error('ML Error:', mlError.message);
      
      if (mlError.code === 'ECONNREFUSED') {
        return res.status(503).json({
          success: false,
          message: 'Cannot connect to ML model'
        });
      }

      if (mlError.code === 'ETIMEDOUT') {
        return res.status(504).json({
          success: false,
          message: 'ML model timeout'
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

    console.log('ML Response received');

    let disease = response.data.predicted_class || response.data.prediction || response.data.disease || response.data.class;
    let confidence = parseFloat(response.data.confidence || 0);

    if (!disease) {
      return res.status(500).json({
        success: false,
        message: 'Invalid ML response'
      });
    }

    disease = disease.trim();
    console.log('Result:', disease, confidence);

    if (confidence < CONFIDENCE_THRESHOLD) {
      return res.status(200).json({
        success: false,
        message: 'Confidence too low',
        confidence: confidence,
        predictedDisease: disease,
        belowThreshold: true
      });
    }

    if (!isValidDisease(disease)) {
      return res.status(200).json({
        success: false,
        message: 'Disease not in trained database',
        detectedClass: disease,
        confidence: confidence,
        invalidClass: true
      });
    }

    const severity = determineSeverity(confidence);
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
            spreading: req.body.spreading === 'true'
          }
        });

        await prediction.save();
        predictionId = prediction._id;
        console.log('Saved:', predictionId);
      } catch (dbError) {
        console.error('DB Error:', dbError.message);
      }
    }

    res.json({
      success: true,
      prediction: disease,
      confidence: confidence,
      severity: severity,
      predictionId: predictionId,
      description: 'Detected: ' + disease,
      recommendations: ['Monitor the condition', 'Keep area clean', 'Avoid scratching', 'Consult a dermatologist']
    });

  } catch (error) {
    console.error('Error:', error.message);
    
    res.status(500).json({ 
      success: false,
      message: 'Prediction failed',
      error: error.message
    });
  }
});

if (Prediction && authMiddleware) {
  router.get('/history', authMiddleware, async function(req, res) {
    try {
      const predictions = await Prediction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
      res.json({ success: true, predictions: predictions });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch history', error: error.message });
    }
  });

  router.get('/:id', authMiddleware, async function(req, res) {
    try {
      const prediction = await Prediction.findOne({ _id: req.params.id, userId: req.user._id });
      if (!prediction) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      res.json({ success: true, prediction: prediction });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/:id', authMiddleware, async function(req, res) {
    try {
      const prediction = await Prediction.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
      if (!prediction) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      res.json({ success: true, message: 'Deleted' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = router;
