const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

// Configure multer for file upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ML Model URL from environment variable
const ML_MODEL_URL = process.env.ML_MODEL_URL || 'http://localhost:5001';

// Test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    success: true,
    message: '✅ Predict route is working!',
    mlModelUrl: ML_MODEL_URL
  });
});

// Main prediction endpoint
router.post('/', upload.single('image'), async (req, res) => {
  try {
    console.log('📸 Received prediction request');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No image file uploaded' 
      });
    }

    console.log('📋 Image received:', req.file.originalname, req.file.size, 'bytes');

    // Extract form data
    const {
      symptoms,
      duration,
      durationOption,
      spreading,
      sensations,
      appearance,
      sunExposure,
      newMedication,
      familyHistory,
      stress,
      oozing,
      severity
    } = req.body;

    console.log('📋 Form data received');

    // Check if ML_MODEL_URL is properly configured
    if (!process.env.ML_MODEL_URL) {
      console.log('⚠️ ML_MODEL_URL not set - using mock prediction');
      
      // MOCK RESPONSE - Returns demo prediction
      return res.json({
        success: true,
        prediction: 'Melanocytic Nevi (Mole)',
        confidence: 0.87,
        description: 'This appears to be a benign mole. However, please consult a dermatologist for accurate diagnosis.',
        recommendations: [
          'Monitor the mole for any changes in size, shape, or color',
          'Protect your skin from sun exposure',
          'Schedule a dermatologist appointment for confirmation',
          'Take photos regularly to track changes'
        ],
        severity: 'Low',
        possibleConditions: [
          { name: 'Melanocytic Nevi', probability: 87 },
          { name: 'Seborrheic Keratosis', probability: 8 },
          { name: 'Dermatofibroma', probability: 5 }
        ],
        message: '⚠️ This is a demo prediction. Connect your ML model by setting ML_MODEL_URL environment variable.'
      });
    }

    // If ML_MODEL_URL is set, forward to actual ML model
    const formData = new FormData();
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    // Add all form fields
    formData.append('symptoms', symptoms || '');
    formData.append('duration', duration || '');
    formData.append('durationOption', durationOption || '');
    formData.append('spreading', spreading || '');
    formData.append('sensations', sensations || '');
    formData.append('appearance', appearance || '');
    formData.append('sunExposure', sunExposure || '');
    formData.append('newMedication', newMedication || '');
    formData.append('familyHistory', familyHistory || '');
    formData.append('stress', stress || '');
    formData.append('oozing', oozing || '');
    formData.append('severity', severity || '');

    console.log(`🚀 Forwarding to ML model at ${ML_MODEL_URL}/predict`);

    // Forward to Python ML model
    const response = await axios.post(`${ML_MODEL_URL}/predict`, formData, {
      headers: {
        ...formData.getHeaders()
      },
      timeout: parseInt(process.env.ML_TIMEOUT || '120000'),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('✅ ML model response received:', response.data);

    // Return the prediction result
    res.json({
      success: true,
      ...response.data
    });

  } catch (error) {
    console.error('❌ Prediction error:', error.message);
    
    if (error.response) {
      console.error('ML server response status:', error.response.status);
      console.error('ML server response data:', error.response.data);
    }

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        success: false,
        message: '⚠️ ML Model server is not running',
        details: `Cannot connect to ${ML_MODEL_URL}. Please start ml_model_server.py or use mock mode.`
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        success: false,
        message: error.response.data.message || 'ML model error',
        details: error.response.data
      });
    }

    res.status(500).json({ 
      success: false,
      message: 'Prediction failed',
      error: error.message 
    });
  }
});

module.exports = router;
