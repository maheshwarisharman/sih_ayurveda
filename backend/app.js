const express = require('express');
const cors = require('cors');
const batchRoutes = require('./routes/batchRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/batches', batchRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send('Welcome to the Ayurveda API');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
