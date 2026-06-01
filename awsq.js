const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Schema for AWS questions
const awsQuestionSchema = new mongoose.Schema({
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

// Model for collection 'quiz20_aws_questions'
const AwsQuestion = mongoose.model(
    'AwsQuestion',
    awsQuestionSchema,
    'quiz20_aws_questions'
);

// GET /api/questions/aws - fetch random AWS questions with optional filters
router.get('/questions/aws', async (req, res) => {
    const { level, section, limit = 20 } = req.query;
    try {
        let query = {};
        if (level && level !== 'All') {
            query.level = level;
        }
        if (section && section !== 'All') {
            query.section = { $regex: section, $options: 'i' };
        }
        const questions = await AwsQuestion.find(query);
        if (!questions || questions.length === 0) {
            return res.json([]);
        }
        const shuffled = questions.sort(() => 0.5 - Math.random());
        res.json(shuffled.slice(0, parseInt(limit)));
    } catch (err) {
        console.error('Error fetching AWS questions:', err);
        res.status(500).json({ error: 'Failed to fetch AWS questions' });
    }
});

// GET /api/questions/aws/sections - distinct sections for UI filtering
router.get('/questions/aws/sections', async (req, res) => {
    try {
        const sections = await AwsQuestion.distinct('section');
        res.json(sections);
    } catch (err) {
        console.error('Error fetching AWS sections:', err);
        res.status(500).json({ error: 'Failed to fetch AWS sections' });
    }
});

module.exports = router;
