const express = require('express');
const router = express.Router();
const TrustSettings = require('../models/trustSettingsModel');
const upload = require('../middleware/upload'); 

router.get('/', async (req, res) => {
  try {
    let settings = await TrustSettings.findOne();
    if (!settings) {
      settings = await TrustSettings.create({});
    }
    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/', upload.fields([
  { name: 'badge1', maxCount: 1 },
  { name: 'badge2', maxCount: 1 },
  { name: 'badge3', maxCount: 1 },
  { name: 'badge4', maxCount: 1 },
  { name: 'factoryImage', maxCount: 1 },
  { name: 'manufacturingUnit', maxCount: 1 },
  { name: 'packingDispatch', maxCount: 1 },
  { name: 'warehouseStorage', maxCount: 1 },
  { name: 'starterBoxImage', maxCount: 1 },
  // ✅ NAYA: Multiple images allow karein (max 20 at a time)
  { name: 'factorySliderImages', maxCount: 20 } 
]), async (req, res) => {
  try {
    let settings = await TrustSettings.findOne();
    if (!settings) settings = new TrustSettings();

    if (req.files && req.files['badge1']) settings.badge1 = req.files['badge1'][0].path;
    if (req.files && req.files['badge2']) settings.badge2 = req.files['badge2'][0].path;
    if (req.files && req.files['badge3']) settings.badge3 = req.files['badge3'][0].path;
    if (req.files && req.files['badge4']) settings.badge4 = req.files['badge4'][0].path;
    if (req.files && req.files['factoryImage']) settings.factoryImage = req.files['factoryImage'][0].path;

    if (req.files && req.files['manufacturingUnit']) settings.manufacturingUnit = req.files['manufacturingUnit'][0].path;
    if (req.files && req.files['packingDispatch']) settings.packingDispatch = req.files['packingDispatch'][0].path;
    if (req.files && req.files['warehouseStorage']) settings.warehouseStorage = req.files['warehouseStorage'][0].path;
    if (req.files && req.files['starterBoxImage']) settings.starterBoxImage = req.files['starterBoxImage'][0].path;

    // ✅ NAYA: Agar admin ne "Clear Old Images" check kiya hai
    if (req.body.clearSlider === 'true') {
        settings.factorySliderImages = [];
    }

    // ✅ NAYA: Nayi uploaded images ko purani list mein add (append) karein
    if (req.files && req.files['factorySliderImages']) {
        const newSliderPaths = req.files['factorySliderImages'].map(file => file.path);
        settings.factorySliderImages = [...settings.factorySliderImages, ...newSliderPaths];
    }

    await settings.save();
    res.status(200).json({ message: 'Trust settings updated successfully', settings });
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

module.exports = router;