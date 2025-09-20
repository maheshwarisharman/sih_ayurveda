const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const pdf = require('pdf-parse');

// IMPORTANT: Make sure to set your GEMINI_API_KEY in a .env file in the root of your project
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System prompt for the Gemini API
const systemPrompt = `
You are an expert in analyzing lab reports for Ayurvedic herbs. Your task is to analyze the provided lab report of an Ayurvedic herb and determine the quality of the herbs.

Based on the lab report, you must provide a quality rating for the herbs. The rating should be one of the following five categories: 'extremely good', 'good', 'healthy', 'bad', or 'very bad'.

You must respond with a JSON object containing a single key: "rating". The value of this key should be the quality rating you have determined.

Example response:
{
  "rating": "good"
}

Do not include any other information or text in your response. Only the JSON object with the rating is required.
`;

/**
 * @route   POST /api/ai/analyse-pdf
 * @desc    Analyzes a lab report PDF for Ayurvedic herbs and returns a quality rating.
 * @access  Public
 */
router.post('/analyse-pdf', async (req, res) => {
  const { pdfUrl } = req.body;

  if (!pdfUrl) {
    return res.status(400).json({ error: 'PDF URL is required.' });
  }

  try {
    // 1. Download the PDF file
    const response = await axios.get(pdfUrl, {
      responseType: 'arraybuffer',
    });

    const buffer = Buffer.from(response.data);

    // 2. Parse the PDF to extract text
    const data = await pdf(buffer);
    const pdfText = data.text;

    // 3. Send the extracted text to Google Gemini for analysis
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "user", parts: [{ text: pdfText }] }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      });
    const geminiResponse = await result.response;
    const text = geminiResponse.text();
    // 4. Parse the JSON response from Gemini
    const jsonResponse = JSON.parse(text);
    const { rating } = jsonResponse;

    // 5. Send the rating back to the client
    res.json({ rating });

  } catch (error) {
    console.error('Error analyzing PDF:', error);
    res.status(500).json({ error: 'Failed to analyze PDF.' });
  }
});

module.exports = router;
