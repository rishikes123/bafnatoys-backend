const express = require('express');
const router = express.Router();
const { createShippingOrder } = require('../controllers/shippingController');
const { adminProtect, isAdmin } = require('../middleware/authMiddleware');

// Create shipping order (admin only)
router.post('/create', adminProtect, isAdmin, createShippingOrder);

module.exports = router;
