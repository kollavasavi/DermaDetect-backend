// routes/llm.js - Hugging Face Integration
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Prediction = require('../models/Prediction');
const authMiddleware = require('../middleware/auth');

// Configuration - USE HUGGING FACE
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL_URL = process.env.ML_MODEL_URL || 'https://api-inference.huggingface.co/models/TinyLlama/TinyLlama-1.1B-Chat-v1.0';
const USE_OPENAI = process.env.USE_OPENAI === 'true';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Timeout configuration (in milliseconds)
const GENERATION_TIMEOUT = parseInt(process.env.LLM_TIMEOUT) || 120000; // 2 minutes default

// Health check state
let hfAvailable = false;
let lastHealthCheck = null;

// Health check for Hugging Face API
async function checkHuggingFaceHealth() {
  if (!HF_TOKEN) {
    console.log('⚠️ HF_TOKEN not set in environment variables');
    hfAvailable = false;
    return false;
  }

  try {
    // Test the API with a simple request
    const response = await axios.post(
      HF_MODEL_URL,
      {
        inputs: "Hello",
        parameters: { max_new_tokens: 10 }
      },
      {
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json'
        },
