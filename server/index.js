require('dotenv').config();
const mongoose = require('mongoose');
const app  = require('./app');
const PORT = process.env.PORT || 4001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cz-self-eval';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log(`✅  MongoDB connected → ${MONGODB_URI.replace(/:\/\/.*@/, '://<credentials>@')}`);
    app.listen(PORT, () => {
      console.log(`🚀  CZ Self-Eval server running on http://localhost:${PORT}`);
      console.log(`     GET    /api/sessions`);
      console.log(`     GET    /api/sessions/:id`);
      console.log(`     POST   /api/sessions          (upsert)`);
      console.log(`     POST   /api/sessions/import   (bulk)`);
      console.log(`     DELETE /api/sessions/:id`);
      console.log(`     GET    /api/sessions/export/all`);
      console.log(`     GET    /api/stats`);
      console.log(`     GET    /api/golden               (list golden scenarios)`);
      console.log(`     POST   /api/golden               (create)`);
      console.log(`     PUT    /api/golden/:id           (update)`);
      console.log(`     DELETE /api/golden/:id           (delete)`);
      console.log(`     POST   /api/golden/:id/run       (run scenario N times)`);
      console.log(`     GET    /api/golden/run-all/stream (SSE batch runner)`);
      console.log(`     GET    /api/eval-score/latest   (CZ Agent Score report)`);
      console.log(`     GET    /api/eval-score/trend    (30-day history)`);
      console.log(`     GET    /api/eval-score/runs     (last 50 runs)`);
      console.log(`     POST   /api/eval-score/run      (kick off multi-judge eval)`);
      console.log(`     GET    /api/eval-score/run/:id/stream (SSE progress)`);
    });
  })
  .catch(err => {
    console.error('❌  MongoDB connection error:', err.message);
    process.exit(1);
  });
