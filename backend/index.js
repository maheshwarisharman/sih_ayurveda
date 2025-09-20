const express = require('express');
const cors = require('cors');
const batchRoutes = require('./routes/batchRoutes');
const aiRoutes = require('./routes/aiRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Middleware
app.use(express.json());

// Routes
app.use('/api/batches', batchRoutes);
app.use('/api/ai', aiRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('Welcome to the Ayurveda API');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
