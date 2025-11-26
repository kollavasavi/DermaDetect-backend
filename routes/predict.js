const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const Prediction = require('../models/Prediction'); // ADD THIS
const authMiddleware = require('../middleware/auth'); // ADD THIS

// ============================================================
// CONFIGURATION
// ============================================================
const ML_MODEL_URL = process.env.ML_MODEL_URL || 'http://localhost:5001';
const CONFIDENCE_THRESHOLD = 0.15; // 15% minimum confidence

// Your 8 trained disease classes
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

// ============================================================
// MULTER CONFIG
// ============================================================
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

// ============================================================
// HELPER: Normalize disease name
// ============================================================
function normalizeDiseaseName(disease) {
  return disease
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // Remove special chars
}

// ============================================================
// HELPER: Validate disease class
// ============================================================
function isValidDisease(disease) {
  const normalized = normalizeDiseaseName(disease);
  return VALID_DISEASES.some(valid => 
    normalizeDiseaseName(valid) === normalized ||
    normalized.includes(normalizeDiseaseName(valid))
  );
}

// ============================================================
// HELPER: Determine severity
// ============================================================
function determineSeverity(confidence) {
  if (confidence >= 0.7) return 'severe';
  if (confidence >= 0.4) return 'moderate';
  return 'mild';
}

// ============================================================
// TEST ENDPOINT
// ============================================================
router.get('/test', (req, res) => {
  res.json({ 
    success: true,
    message: '✅ Predict route is working!',
    mlModelUrl: ML_MODEL_URL,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    validDiseases: VALID_DISEASES
  });
});

// ============================================================
// MAIN PREDICTION ENDPOINT
// ============================================================
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    console.log('📸 Received prediction request from user:', req.user._id);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No image file uploaded' 
      });
    }

    console.log('📋 Image:', req.file.originalname, req.file.size, 'bytes');

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

    // ============================================================
    // MOCK MODE (if ML_MODEL_URL not configured)
    // ============================================================
    if (!process.env.ML_MODEL_URL) {
      console.log('⚠️ ML_MODEL_URL not set - using mock prediction');
      
      return res.json({
        success: true,
        prediction: 'Melanoma',
        confidence: 0.87,
        severity: 'severe',
        description: 'This is a DEMO prediction. Connect your ML model.',
        recommendations: [
          'Monitor the condition closely',
          'Protect your skin from sun exposure',
          'Schedule a dermatologist appointment',
          'Take photos regularly to track changes'
        ],
        message: '⚠️ Demo mode. Set ML_MODEL_URL to use real predictions.'
      });
    }

    // ============================================================
    // FORWARD TO ML MODEL
    // ============================================================
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

    const response = await axios.post(`${ML_MODEL_URL}/predict`, formData, {
      headers: {
        ...formData.getHeaders()
      },
      timeout: parseInt(process.env.ML_TIMEOUT || '120000'),
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('✅ ML model response:', response.data);

    // ============================================================
    // EXTRACT AND VALIDATE PREDICTION
    // ============================================================
    let disease = response.data.predicted_class || 
                  response.data.prediction || 
                  response.data.disease;
    
    let confidence = parseFloat(response.data.confidence || 0);

    if (!disease) {
      throw new Error('ML model did not return a prediction');
    }

    disease = disease.trim();

    console.log(`🔍 Disease: "${disease}", Confidence: ${(confidence * 100).toFixed(1)}%`);

    // ============================================================
    // CHECK 1: CONFIDENCE THRESHOLD
    // ============================================================
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.warn(`⚠️ Low confidence: ${(confidence * 100).toFixed(1)}%`);
      return res.status(200).json({
        success: false,
        message: `Prediction confidence too low (${(confidence * 100).toFixed(1)}%).\n\nPlease try:\n• Taking a clearer photo\n• Better lighting conditions\n• Closer view of the affected area\n• Consulting a dermatologist for accurate diagnosis`,
        confidence: confidence,
        predictedDisease: disease,
        belowThreshold: true
      });
    }

    // ============================================================
    // CHECK 2: VALID DISEASE CLASS
    // ============================================================
    if (!isValidDisease(disease)) {
      console.warn(`⚠️ Invalid disease: "${disease}"`);
      return res.status(200).json({
        success: false,
        message: `The detected condition "${disease}" is not in our trained database.\n\nOur system is trained to detect:\n${VALID_DISEASES.join(', ')}\n\nPlease consult a dermatologist for accurate diagnosis.`,
        detectedClass: disease,
        confidence: confidence,
        invalidClass: true,
        trainedClasses: VALID_DISEASES
      });
    }

    // ============================================================
    // DETERMINE SEVERITY
    // ============================================================
    const finalSeverity = severity || determineSeverity(confidence);

    // ============================================================
    // SAVE TO DATABASE
    // ============================================================
    const prediction = new Prediction({
      userId: req.user._id,
      disease: disease,
      confidence: confidence,
      severity: finalSeverity,
      imageUrl: req.file.originalname,
      metadata: {
        symptoms: symptoms || "",
        duration: duration || "",
        durationOption: durationOption || "",
        spreading: spreading || false,
        sensations: Array.isArray(sensations) ? sensations : [],
        appearance: Array.isArray(appearance) ? appearance : [],
        sunExposure: sunExposure || "",
        newMedication: newMedication || "",
        familyHistory: familyHistory || "",
        stress: stress || "",
        oozing: oozing || "",
      },
    });

    await prediction.save();

    console.log('✅ Prediction saved to DB:', prediction._id);

    // ============================================================
    // RETURN SUCCESS RESPONSE
    // ============================================================
    res.json({
      success: true,
      prediction: disease,
      confidence: confidence,
      severity: finalSeverity,
      predictionId: prediction._id,
      description: response.data.description || `Detected: ${disease}`,
      recommendations: response.data.recommendations || [
        'Monitor the condition closely',
        'Keep the affected area clean and dry',
        'Avoid scratching or picking',
        'Consult a dermatologist for proper treatment'
      ],
      possibleConditions: response.data.possibleConditions || [
        { name: disease, probability: Math.round(confidence * 100) }
      ],
      createdAt: prediction.createdAt
    });

  } catch (error) {
    console.error('❌ Prediction error:', error.message);
    
    if (error.response) {
      console.error('ML server status:', error.response.status);
      console.error('ML server data:', error.response.data);
    }

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        success: false,
        message: '⚠️ ML Model server is not running',
        details: `Cannot connect to ${ML_MODEL_URL}. Please start your ML model server.`
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

// ============================================================
// GET PREDICTION HISTORY
// ============================================================
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const predictions = await Prediction.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    const stats = {
      total: predictions.length,
      avgConfidence: predictions.length > 0 
        ? (predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length)
        : 0,
      uniqueDiseases: [...new Set(predictions.map(p => p.disease))].length
    };

    res.json({
      success: true,
      predictions: predictions,
      stats: stats
    });
  } catch (error) {
    console.error('❌ History fetch error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch history',
      error: error.message
    });
  }
});

// ============================================================
// GET SINGLE PREDICTION BY ID
// ============================================================
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const prediction = await Prediction.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!prediction) {
      return res.status(404).json({
        success: false,
        message: 'Prediction not found'
      });
    }

    res.json({
      success: true,
      prediction: prediction
    });
  } catch (error) {
    console.error('❌ Fetch error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch prediction',
      error: error.message
    });
  }
});

// ============================================================
// DELETE PREDICTION
// ============================================================
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const prediction = await Prediction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!prediction) {
      return res.status(404).json({
        success: false,
        message: 'Prediction not found'
      });
    }

    console.log('🗑️ Deleted prediction:', req.params.id);

    res.json({
      success: true,
      message: 'Prediction deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete prediction',
      error: error.message
    });
  }
});

// ============================================================
// CLEAR ALL HISTORY
// ============================================================
router.delete('/history/clear', authMiddleware, async (req, res) => {
  try {
    const result = await Prediction.deleteMany({ userId: req.user._id });

    console.log(`🗑️ Cleared ${result.deletedCount} predictions for user ${req.user._id}`);

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} predictions`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('❌ Clear history error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to clear history',
      error: error.message
    });
  }
});

module.exports = router;
