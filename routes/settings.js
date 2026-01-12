const express = require('express');
const router = express.Router();
const ShippingSettings = require('../models/ShippingSettings');

// GET Shipping Settings
router.get('/', async (req, res) => {
  try {
    let settings = await ShippingSettings.findOne();
    if (!settings) {
      settings = await ShippingSettings.create({ shippingCharge: 250, freeShippingThreshold: 5000 });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE Shipping Settings
router.put('/', async (req, res) => {
  try {
    const { shippingCharge, freeShippingThreshold } = req.body;
    
    const settings = await ShippingSettings.findOneAndUpdate(
      {}, 
      { shippingCharge, freeShippingThreshold },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;