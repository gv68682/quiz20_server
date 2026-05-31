const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Schema for cloud questions
const cloudQuestionSchema = new mongoose.Schema({
    id: { type: String, required: true },
    timestamp_reference: String,
    type: { type: String, required: true },
    level: { type: String, required: true },
    section: { type: String, required: true },
    question: { type: String, required: true },
    options: [String],
    answer: { type: String, required: true },
    explanation: String
});

// Create model mapping to collection 'quiz20_cloud_questions'
const CloudQuestion = mongoose.model(
    'CloudQuestion',
    cloudQuestionSchema,
    'quiz20_cloud_questions'
);

// GET /api/questions/cloud
// Fetch, optionally filter by level/section, and randomly select questions
router.get('/questions/cloud', async (req, res) => {
    const { level, section, limit = 20 } = req.query;
    try {
        let query = {};
        if (level && level !== 'All') {
            query.level = level;
        }
        if (section && section !== 'All') {
            query.section = { $regex: section, $options: 'i' };
        }

        const questions = await CloudQuestion.find(query);

        if (!questions || questions.length === 0) {
            return res.json([]);
        }

        // Shuffle the results
        const shuffled = questions.sort(() => 0.5 - Math.random());
        res.json(shuffled.slice(0, parseInt(limit)));
    } catch (err) {
        console.error("Error fetching cloud questions:", err);
        res.status(500).json({ error: "Failed to fetch cloud questions" });
    }
});

// GET /api/questions/cloud/sections
// Retrieve all distinct sections for section-based filtering on the client
router.get('/questions/cloud/sections', async (req, res) => {
    try {
        const sections = await CloudQuestion.distinct('section');
        res.json(sections);
    } catch (err) {
        console.error("Error fetching cloud sections:", err);
        res.status(500).json({ error: "Failed to fetch cloud sections" });
    }
});

module.exports = router;
