const express = require('express');
const router = express.Router();
const ShippingSettings = require('../models/ShippingSettings');
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// GET: Saare rules (frontend checkout ke liye - public)
router.get('/', async (req, res) => {
  try {
    let settings = await ShippingSettings.findOne();
    if (!settings) return res.json([]);
    res.json(settings.volumeDiscountsEnabled === false ? [] : settings.discountRules || []);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// Admin receives saved rules even while discounts are disabled.
router.get('/admin', adminProtect, isAdmin, async (req, res) => {
  try {
    const settings = await ShippingSettings.findOne();
    res.json({ enabled: settings?.volumeDiscountsEnabled !== false, rules: settings?.discountRules || [] });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// PUT: Rules save (admin only)
router.put('/', adminProtect, isAdmin, async (req, res) => {
  try {
    const { rules, enabled } = req.body;
    if (!Array.isArray(rules) || (enabled !== undefined && typeof enabled !== 'boolean')) {
      return res.status(400).json({ message: "Invalid discount settings" });
    }
    const update = { discountRules: rules };
    if (enabled !== undefined) update.volumeDiscountsEnabled = enabled;
    const settings = await ShippingSettings.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true }
    );
    res.json({ success: true, data: settings.discountRules });
  } catch (err) {
    res.status(500).json({ message: "Save Failed" });
  }
});

module.exports = router;
