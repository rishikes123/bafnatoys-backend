const express = require('express');
const router = express.Router();
const { handleChatMessage } = require('../controllers/chatbotController');

// POST route for frontend to send messages
router.post('/message', handleChatMessage);

module.exports = router;