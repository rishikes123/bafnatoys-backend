const express = require('express');
const router = express.Router();
const TrustSettings = require('../models/trustSettingsModel');
const upload = require('../middleware/upload'); 

router.get('/', async (req, res) => {
  try {
    let settings = await TrustSettings.findOne();
    if (!settings) settings = await TrustSettings.create({});
    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/', upload.fields([
  { name: 'factoryImage', maxCount: 1 },
  { name: 'manufacturingUnit', maxCount: 1 },
  { name: 'packingDispatch', maxCount: 1 },
  { name: 'warehouseStorage', maxCount: 1 },
  { name: 'reviewImages', maxCount: 10 },
  { name: 'makeInIndiaLogo', maxCount: 1 },
  // ✅ NAYA: Dynamic factory visuals ke images ke liye
  { name: 'factoryVisualImages', maxCount: 10 } 
]), async (req, res) => {
  try {
    let settings = await TrustSettings.findOne();
    if (!settings) settings = new TrustSettings();

    // Text & Links
    if (req.body.retailerCount !== undefined) settings.retailerCount = req.body.retailerCount;
    if (req.body.youtubeLink !== undefined) settings.youtubeLink = req.body.youtubeLink;
    if (req.body.instagramLink !== undefined) settings.instagramLink = req.body.instagramLink;
    if (req.body.facebookLink !== undefined) settings.facebookLink = req.body.facebookLink;
    if (req.body.linkedinLink !== undefined) settings.linkedinLink = req.body.linkedinLink;

    // Static Images
    if (req.files && req.files['factoryImage']) settings.factoryImage = req.files['factoryImage'][0].path;
    if (req.files && req.files['manufacturingUnit']) settings.manufacturingUnit = req.files['manufacturingUnit'][0].path;
    if (req.files && req.files['packingDispatch']) settings.packingDispatch = req.files['packingDispatch'][0].path;
    if (req.files && req.files['warehouseStorage']) settings.warehouseStorage = req.files['warehouseStorage'][0].path;

    // Logos Save Karna
    if (req.files && req.files['makeInIndiaLogo']) settings.makeInIndiaLogo = req.files['makeInIndiaLogo'][0].path;

    // ✅ NAYA: Dynamic Factory Visuals Handle Karna
    if (req.body.factoryVisualsData) {
        const parsedVisuals = JSON.parse(req.body.factoryVisualsData);
        let imageIndex = 0;
        const visualFiles = req.files['factoryVisualImages'] || [];
        
        settings.factoryVisuals = parsedVisuals.map(vis => {
            let imgPath = vis.existingImage || '';
            if (vis.hasNewImage && imageIndex < visualFiles.length) {
                imgPath = visualFiles[imageIndex].path;
                imageIndex++;
            }
            return { image: imgPath, label: vis.label };
        });
    }

    // Reviews Data
    if (req.body.reviewsData) {
        const parsedReviews = JSON.parse(req.body.reviewsData);
        let imageIndex = 0;
        const reviewFiles = req.files['reviewImages'] || [];
        settings.customerReviews = parsedReviews.map(rev => {
            let imgPath = rev.existingImage || '';
            if (rev.hasNewImage && imageIndex < reviewFiles.length) {
                imgPath = reviewFiles[imageIndex].path;
                imageIndex++;
            }
            return { image: imgPath, reviewText: rev.text, reviewerName: rev.name, rating: rev.rating || 5 };
        });
    }

    await settings.save();
    res.status(200).json({ message: 'Settings updated successfully', settings });
  } catch (error) {
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

module.exports = router;