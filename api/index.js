require('dotenv').config();
const mongoose = require('mongoose');
const app = require('../server/app');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cz-self-eval';

// Cache the connection promise across warm invocations
let mongoConnecting = null;

module.exports = async (req, res) => {
  if (mongoose.connection.readyState < 1) {
    if (!mongoConnecting) {
      mongoConnecting = mongoose.connect(MONGODB_URI, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 5000,
      })
        .then(() => console.log('✅  MongoDB connected (serverless)'))
        .catch(err => {
          mongoConnecting = null; // reset so next request retries
          throw err;
        });
    }
    try {
      await mongoConnecting;
    } catch (err) {
      console.error('❌  MongoDB connection error:', err.message);
      return res.status(503).json({ error: 'Database unavailable' });
    }
  }
  return app(req, res);
};
