// backend/routes/analysis.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// POST /api/analysis/predict - Send image to ML model for analysis
router.post('/predict', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    // Get additional form data
    const formData = {
      symptoms: req.body.symptoms || '',
      duration: req.body.duration || '',
      severity: req.body.severity || '',
      age: req.body.age || '',
      location: req.body.location || '',
      spreading: req.body.spreading || '',
      pain: req.body.pain || '',
      itching: req.body.itching || '',
      previousTreatment: req.body.previousTreatment || '',
      allergies: req.body.allergies || '',
      medications: req.body.medications || ''
    };

    console.log('📊 Received analysis request:', {
      filename: req.file.originalname,
      size: req.file.size,
      symptoms: formData.symptoms
    });

    // ML Model API URL (update this to your actual ML model endpoint)
    const ML_MODEL_URL = process.env.ML_MODEL_URL || 'http://localhost:5001/predict';

    // Create FormData to send to ML model
    const mlFormData = new FormData();
    mlFormData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Add additional data to ML request
    mlFormData.append('symptoms', formData.symptoms);
    mlFormData.append('age', formData.age);
    mlFormData.append('location', formData.location);
    mlFormData.append('duration', formData.duration);
    mlFormData.append('severity', formData.severity);

    // Send image to ML model for prediction
    const mlResponse = await axios.post(ML_MODEL_URL, mlFormData, {
      headers: {
        ...mlFormData.getHeaders(),
      },
      timeout: 30000 // 30 second timeout
    });

    console.log('✅ ML Model response received:', mlResponse.data);

    // Convert image to base64 for frontend display
    const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Return prediction results
    res.status(200).json({
      predicted_disease: mlResponse.data.disease || mlResponse.data.predicted_class || 'Unknown',
      confidence: mlResponse.data.confidence || 0,
      image: imageBase64,
      probabilities: mlResponse.data.probabilities || {},
      recommendations: mlResponse.data.recommendations || []
    });

  } catch (error) {
    console.error('❌ Analysis error:', error.message);

    // Check if ML model is not running
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        message: 'ML model service is not available. Please ensure the model server is running.',
        error: 'Model service unavailable'
      });
    }

    // Check for timeout
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ 
        message: 'Analysis timed out. Please try again.',
        error: 'Request timeout'
      });
    }

    res.status(500).json({ 
      message: 'Error analyzing image',
      error: error.message 
    });
  }
});

// GET /api/analysis/test - Test if ML model is accessible
router.get('/test', async (req, res) => {
  try {
    const ML_MODEL_URL = process.env.ML_MODEL_URL || 'http://localhost:5001';
    
    const response = await axios.get(`${ML_MODEL_URL}/health`, {
      timeout: 5000
    });

    res.status(200).json({
      message: 'ML model is accessible',
      modelStatus: response.data
    });
  } catch (error) {
    res.status(503).json({
      message: 'ML model is not accessible',
      error: error.message
    });
  }
});

module.exports = router;