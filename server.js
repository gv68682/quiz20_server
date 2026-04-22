const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error:', err));

// Question Schema
const questionSchema = new mongoose.Schema({
    text: String,
    options: [String],
    correctAnswer: Number,
    category: String, // 'Python' or 'AI'
    difficulty: String, // 'Beginner', 'Intermediate', 'Advanced'
    explanation: String
});

const Question = mongoose.model('Question', questionSchema);

// External Sources URLs — all values defined in .env
const SOURCES = {
    Python: [
        process.env.PYTHON_JSON_Q1,
        process.env.PYTHON_JSON_Q4
    ],
    AI: [
        process.env.AI_JSON_Q1
    ]
};

// Validate that required URL env vars are present at startup
const REQUIRED_URL_VARS = ['PYTHON_JSON_Q1', 'PYTHON_JSON_Q4', 'AI_JSON_Q1', 'URL_OPENTDB_GADGETS'];
REQUIRED_URL_VARS.forEach(key => {
    if (!process.env[key]) console.warn(`[ENV] Missing required URL: ${key}`);
});

// Normalize incoming difficulty string to canonical values
const DIFFICULTY_MAP = {
    'low': 'Beginner',
    'beginner': 'Beginner',
    'easy': 'Beginner',
    'medium': 'Intermediate',
    'intermediate': 'Intermediate',
    'hard': 'Advanced',
    'advanced': 'Advanced',
    'high': 'Advanced'
};

function normalizeDifficulty(raw) {
    if (!raw) return 'Beginner';
    return DIFFICULTY_MAP[raw.toLowerCase()] || 'Beginner';
}

// Infer difficulty from question text for sources that don't provide it
function inferDifficultyFromText(text) {
    const t = text.toLowerCase();
    const advancedKeywords = ['decorator', 'metaclass', 'generator', 'coroutine', 'asyncio', 'descriptor',
        'mro', 'gil', 'cpython', 'bytecode', 'gc', 'memory management', '__slots__',
        'context manager', 'protocol', 'abc', 'dataclass', 'typing', 'comprehension'];
    const intermediateKeywords = ['lambda', 'class', 'inheritance', 'exception', 'module', 'package',
        'iterator', 'list comprehension', 'dict comprehension', 'try', 'except',
        'with', 'import', 'scope', 'closure', 'args', 'kwargs', 'global', 'nonlocal'];
    for (const kw of advancedKeywords) {
        if (t.includes(kw)) return 'Advanced';
    }
    for (const kw of intermediateKeywords) {
        if (t.includes(kw)) return 'Intermediate';
    }
    return 'Beginner';
}

// Helper: Fetch and Parse Questions
async function fetchQuestionsFromWeb(category, difficulty, limit) {
    // Normalize difficulty once at the top so all filtering is consistent
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    let allFetched = [];
    const TIMEOUT = 8000;

    const isStrictlyPython = (text) => {
        const t = text.toLowerCase();
        if (!t.includes('python')) return false;
        const FORBIDDEN_KEYWORDS = ['java', 'c++', 'c#', 'php', 'javascript', 'ruby', 'rust', 'swift',
            'objective-c', 'kotlin', 'dart', 'html', 'css', 'sql', 'fortran', 'cobol',
            'basic', 'pascal', 'assembly'];
        for (const word of FORBIDDEN_KEYWORDS) { if (t.includes(word)) return false; }
        if (/\b[Cc]\b/.test(t)) return false;
        return true;
    };

    try {
        if (category === 'Python') {
            const pythonUrls = [
                process.env.PYTHON_JSON_Q1,
                process.env.PYTHON_JSON_Q4,
                process.env.URL_OPENTDB_GADGETS
            ];

            const requests = pythonUrls.map(url => axios.get(url, { timeout: TIMEOUT }).catch(() => null));
            const responses = await Promise.all(requests);

            responses.forEach((res, idx) => {
                if (!res || !res.data) return;

                if (idx === 0 && res.data.questions) {
                    // GitHub GTref
                    const mapped = res.data.questions
                        .filter(q => isStrictlyPython(q.question))
                        .map(q => ({
                            text: q.question,
                            options: q.answers,
                            correctAnswer: q.correct_index,
                            category: 'Python',
                            // Infer difficulty from content instead of hardcoding 'Beginner'
                            difficulty: inferDifficultyFromText(q.question)
                        }));
                    allFetched = [...allFetched, ...mapped];

                } else if (idx === 1 && res.data.results) {
                    // OpenTDB Computer Science — URL_PYTHON_OPENTDB
                    const mapped = res.data.results
                        .filter(q => isStrictlyPython(q.question))
                        .map(q => {
                            const options = [...q.incorrect_answers];
                            const correctIdx = Math.floor(Math.random() * (options.length + 1));
                            options.splice(correctIdx, 0, q.correct_answer);
                            const diffMap = { 'easy': 'Beginner', 'medium': 'Intermediate', 'hard': 'Advanced' };
                            return {
                                text: q.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&rsquo;/g, "'"),
                                options: options.map(o => o.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&rsquo;/g, "'")),
                                correctAnswer: correctIdx,
                                category: 'Python',
                                difficulty: diffMap[q.difficulty] || 'Intermediate'
                            };
                        });
                    allFetched = [...allFetched, ...mapped];

                } else if (idx === 2 && Array.isArray(res.data)) {
                    const mapped = res.data.map(q => {
                        let correctIndex = 0;
                        const options = Array.isArray(q.options) ? q.options : [];

                        // Case 1: numeric (1-based)
                        if (typeof q.answer === 'number') {
                            correctIndex = q.answer - 1;
                        }

                        // Case 2: letter (A, B, C...)
                        else if (typeof q.answer === 'string') {
                            const ans = q.answer.trim();

                            // Try letter format first
                            if (ans.length === 1 && ans.toUpperCase() >= 'A' && ans.toUpperCase() <= 'Z') {
                                correctIndex = ans.toUpperCase().charCodeAt(0) - 65;
                            } 
                            // Case 3: exact string match
                            else {
                                const foundIndex = options.findIndex(opt => opt.trim() === ans);
                                if (foundIndex !== -1) {
                                    correctIndex = foundIndex;
                                }
                            }
                        }
                        // Safety clamp
                        if (correctIndex < 0 || correctIndex >= options.length) {
                            correctIndex = 0;
                        }

                        return {
                            text: q.question,
                            options,
                            correctAnswer: correctIndex,
                            category: 'Python',
                            difficulty: inferDifficultyFromText(q.question)
                        };
                    });
                    allFetched = [...allFetched, ...mapped];
                } else if (idx === 3 && res.data.results) {
                    const mapped = res.data.results
                        .filter(q => isStrictlyPython(q.question))
                        .map(q => {
                            const options = [...q.incorrect_answers];
                            const correctIdx = Math.floor(Math.random() * (options.length + 1));
                            options.splice(correctIdx, 0, q.correct_answer);
                            const diffMap = { 'easy': 'Beginner', 'medium': 'Intermediate', 'hard': 'Advanced' };
                            return {
                                text: q.question.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&rsquo;/g, "'"),
                                options: options.map(o => o.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&rsquo;/g, "'")),
                                correctAnswer: correctIdx,
                                category: 'Python',
                                difficulty: diffMap[q.difficulty] || 'Intermediate'
                            };
                        });
                    allFetched = [...allFetched, ...mapped];
                }
            });

        } else if (category === 'AI') {
            const res = await axios.get(SOURCES.AI[0], { timeout: TIMEOUT }).catch(() => null);
            if (res && res.data && Array.isArray(res.data)) {
                const quizzesObj = res.data.find(o => o.quizzes);
                if (quizzesObj && quizzesObj.quizzes) {
                    quizzesObj.quizzes.forEach(qz => {
                        if (qz.quiz) {
                            let qzDiff = 'Intermediate';
                            const title = qz.title.toLowerCase();
                            if (title.includes('pre-lecture')) qzDiff = 'Beginner';
                            else if (title.includes('post-lecture')) qzDiff = 'Intermediate';

                            if (title.includes('post-lecture') &&
                                (title.includes('neural') || title.includes('time series') ||
                                 title.includes('reinforcement') || title.includes('nlp'))) {
                                qzDiff = 'Advanced';
                            }

                            const mapped = qz.quiz.map(q => ({
                                text: q.questionText,
                                options: q.answerOptions.map(ao => ao.answerText),
                                correctAnswer: q.answerOptions.findIndex(ao => ao.isCorrect === "true" || ao.isCorrect === true),
                                category: 'AI',
                                difficulty: qzDiff,
                                explanation: `Topic: ${qz.title.replace(/Post-Lecture Quiz/i, '').replace(/: Pre-Lecture Quiz/i, '')
                                                        .replace(/^Topic:\s*/i, '')
                                                        .replace(/[:\-–—]+\s*$/g, '')
                                                        .trim()}`
                            }));
                            allFetched = [...allFetched, ...mapped];
                        }
                    });
                }
            }
        }

        // Filter strictly by requested difficulty — NO cross-difficulty fallback
        const filteredPool = allFetched.filter(q => q.difficulty === normalizedDifficulty);

        // Deduplicate within the correct difficulty tier only
        const uniquePool = [];
        const seen = new Set();
        filteredPool.forEach(q => {
            if (!seen.has(q.text)) {
                seen.add(q.text);
                uniquePool.push(q);
            }
        });

        if (uniquePool.length < 10) {
            console.warn(`[fetchQuestionsFromWeb] Only ${uniquePool.length} questions found for ${category}/${normalizedDifficulty}. Consider adding more sources.`);
        }

        // Shuffle and limit
        const finalPool = uniquePool.sort(() => 0.5 - Math.random());
        return finalPool.slice(0, Math.max(10, parseInt(limit)));

    } catch (err) {
        console.error('Error fetching external questions:', err);
        return [];
    }
}

// Routes
app.get('/api/questions/random', async (req, res) => {
    const { category, difficulty, limit = 20 } = req.query;
    try {
        const questions = await fetchQuestionsFromWeb(category || 'Python', difficulty || 'Beginner', limit);
        res.json(questions);
    } catch (err) {
        res.status(500).json([]);
    }
});

// Seed Route (Mainly for manual DB injection now)
app.post('/api/seed', async (req, res) => {
    try {
        const questions = req.body;
        if (!questions || !questions.length) {
            return res.status(400).json({ message: 'No questions provided for seeding.' });
        }
        if (mongoose.connection.readyState === 1) {
            await Question.deleteMany({ category: { $in: ['Python', 'AI'] } });
            await Question.insertMany(questions);
        }
        res.json({ message: 'Seeded successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});