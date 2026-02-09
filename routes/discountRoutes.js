const express = require('express');
const router = express.Router();
const ShippingSettings = require('../models/ShippingSettings');

// 1. GET: Saare rules lene ke liye
router.get('/', async (req, res) => {
  try {
    let settings = await ShippingSettings.findOne();
    
    // Agar settings nahi hain, to empty array bhejo
    if (!settings) {
      return res.json([]); 
    }
    
    res.json(settings.discountRules || []);
  } catch (err) {
    console.error("Error fetching discounts:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// 2. PUT: Rules save karne ke liye
router.put('/', async (req, res) => {
  try {
    const { rules } = req.body; // Frontend se { rules: [...] } aa raha hai

    // Purane settings dhoondho aur update karo, ya naya banao
    const settings = await ShippingSettings.findOneAndUpdate(
      {}, 
      { $set: { discountRules: rules } },
      { new: true, upsert: true } // new: true returns updated doc, upsert creates if missing
    );

    res.json({ success: true, data: settings.discountRules });
  } catch (err) {
    console.error("Error saving discounts:", err);
    res.status(500).json({ message: "Save Failed" });
  }
});

module.exports = router;