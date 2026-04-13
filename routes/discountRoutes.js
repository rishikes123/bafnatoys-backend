const express = require('express');
const router = express.Router();
const ShippingSettings = require('../models/ShippingSettings');
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// GET: Saare rules (frontend checkout ke liye - public)
router.get('/', async (req, res) => {
  try {
    let settings = await ShippingSettings.findOne();
    if (!settings) return res.json([]);
    res.json(settings.discountRules || []);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// PUT: Rules save (admin only)
router.put('/', adminProtect, isAdmin, async (req, res) => {
  try {
    const { rules } = req.body;
    const settings = await ShippingSettings.findOneAndUpdate(
      {},
      { $set: { discountRules: rules } },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: settings.discountRules });
  } catch (err) {
    res.status(500).json({ message: "Save Failed" });
  }
});

module.exports = router;
