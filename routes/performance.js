// backend/routes/performance.js
const express = require('express');
const router = express.Router();

// This would typically come from your ML model evaluation
// You should run this after training your model
const modelMetrics = {
  accuracy: 94.5,
  precision: 92.8,
  recall: 91.3,
  f1Score: 92.0,
  confusionMatrix: {
    truePositive: 450,
    trueNegative: 420,
    falsePositive: 35,
    falseNegative: 45
  },
  classPerformance: [
    { name: 'Acne', accuracy: 95.2, precision: 94.1, recall: 93.8, f1: 93.9, count: 120 },
    { name: 'Eczema', accuracy: 93.8, precision: 92.5, recall: 91.9, f1: 92.2, count: 98 },
    { name: 'Melanoma', accuracy: 96.1, precision: 95.8, recall: 95.5, f1: 95.6, count: 85 },
    { name: 'Psoriasis', accuracy: 92.5, precision: 91.2, recall: 90.8, f1: 91.0, count: 110 },
    { name: 'Rosacea', accuracy: 91.8, precision: 90.5, recall: 90.1, f1: 90.3, count: 75 }
  ],
  trainingHistory: {
    epochs: 50,
    trainingAccuracy: [0.65, 0.72, 0.78, 0.83, 0.87, 0.90, 0.92, 0.94, 0.945, 0.95],
    validationAccuracy: [0.63, 0.70, 0.75, 0.80, 0.85, 0.88, 0.90, 0.92, 0.925, 0.93],
    trainingLoss: [0.85, 0.72, 0.58, 0.45, 0.35, 0.28, 0.22, 0.18, 0.15, 0.12],
    validationLoss: [0.88, 0.75, 0.62, 0.50, 0.40, 0.33, 0.28, 0.24, 0.21, 0.19]
  },
  datasetInfo: {
    totalSamples: 950,
    trainingSamples: 760,
    validationSamples: 95,
    testSamples: 95,
    classes: 5,
    imageSize: '224x224',
    augmentation: true
  },
  lastUpdated: new Date().toISOString()
};

// @route   GET /api/performance/metrics
// @desc    Get model performance metrics
// @access  Public (or you can add auth middleware)
router.get('/metrics', async (req, res) => {
  try {
    res.json({
      success: true,
      data: modelMetrics
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch performance metrics',
      error: error.message
    });
  }
});

// @route   GET /api/performance/live-stats
// @desc    Get live prediction statistics
// @access  Public
router.get('/live-stats', async (req, res) => {
  try {
    // This would come from your database
    // Example: Count predictions by disease type
    const liveStats = {
      totalPredictions: 1250,
      todayPredictions: 45,
      averageConfidence: 0.89,
      mostCommonDisease: 'Acne',
      recentPredictions: [
        { disease: 'Acne', confidence: 0.94, timestamp: new Date() },
        { disease: 'Eczema', confidence: 0.88, timestamp: new Date() },
        { disease: 'Psoriasis', confidence: 0.91, timestamp: new Date() }
      ]
    };

    res.json({
      success: true,
      data: liveStats
    });
  } catch (error) {
    console.error('Error fetching live stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch live statistics'
    });
  }
});

module.exports = router;