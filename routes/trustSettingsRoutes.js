const express = require('express');
const router = express.Router();
const TrustSettings = require('../models/trustSettingsModel');
const imagekit = require('../config/imagekit');
const multer = require('multer');
const { adminProtect, isAdmin } = require('../middleware/authMiddleware');

// Multer RAM Storage with 5MB Limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Helper for ImageKit Upload
const uploadToImageKit = (file, folderPath) => {
  return imagekit.upload({
    file: file.buffer,
    fileName: `trust_${Date.now()}_${file.originalname.replace(/\s+/g, '-')}`,
    folder: `/bafnatoys/${folderPath}`,
  });
};

// GET Settings
router.get('/', async (req, res) => {
  try {
    let settings = await TrustSettings.findOne();
    if (!settings) settings = await TrustSettings.create({});
    res.status(200).json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// PUT (Update) Settings
router.put('/', adminProtect, isAdmin, upload.fields([
  { name: 'factoryImage', maxCount: 1 },
  { name: 'makeInIndiaLogo', maxCount: 1 },
  { name: 'reviewImages', maxCount: 10 },
  { name: 'factoryVisualImages', maxCount: 10 } 
]), async (req, res) => {
  try {
    let settings = await TrustSettings.findOne();
    if (!settings) settings = new TrustSettings();

    // 1. Text & Links
    if (req.body.retailerCount !== undefined) settings.retailerCount = req.body.retailerCount;
    if (req.body.youtubeLink !== undefined) settings.youtubeLink = req.body.youtubeLink;
    if (req.body.instagramLink !== undefined) settings.instagramLink = req.body.instagramLink;
    if (req.body.facebookLink !== undefined) settings.facebookLink = req.body.facebookLink;
    if (req.body.linkedinLink !== undefined) settings.linkedinLink = req.body.linkedinLink;

    // 2. Single Static Images (Factory Image & Make In India Logo)
    if (req.files && req.files['factoryImage']) {
      if (settings.factoryImageId) await imagekit.deleteFile(settings.factoryImageId).catch(()=>{});
      const result = await uploadToImageKit(req.files['factoryImage'][0], 'trust');
      settings.factoryImage = result.url;
      settings.factoryImageId = result.fileId;
    }
    
    if (req.files && req.files['makeInIndiaLogo']) {
      if (settings.makeInIndiaLogoId) await imagekit.deleteFile(settings.makeInIndiaLogoId).catch(()=>{});
      const result = await uploadToImageKit(req.files['makeInIndiaLogo'][0], 'trust');
      settings.makeInIndiaLogo = result.url;
      settings.makeInIndiaLogoId = result.fileId;
    }

    // 3. Dynamic Factory Visuals
    if (req.body.factoryVisualsData) {
      const parsedVisuals = JSON.parse(req.body.factoryVisualsData);
      const visualFiles = req.files['factoryVisualImages'] || [];
      let imageIndex = 0;

      // Cleanup removed images from ImageKit
      const retainedVisualUrls = parsedVisuals.map(v => v.existingImage).filter(Boolean);
      const visualsToDelete = settings.factoryVisuals.filter(old => old.image && !retainedVisualUrls.includes(old.image) && old.imageId);
      for (const img of visualsToDelete) {
        await imagekit.deleteFile(img.imageId).catch(()=>{});
      }

      const updatedVisuals = [];
      for (const vis of parsedVisuals) {
        if (vis.hasNewImage && imageIndex < visualFiles.length) {
          const result = await uploadToImageKit(visualFiles[imageIndex], 'factory');
          updatedVisuals.push({ image: result.url, imageId: result.fileId, label: vis.label });
          imageIndex++;
        } else {
          const oldMatch = settings.factoryVisuals.find(o => o.image === vis.existingImage);
          updatedVisuals.push({ image: vis.existingImage || '', imageId: oldMatch ? oldMatch.imageId : '', label: vis.label });
        }
      }
      settings.factoryVisuals = updatedVisuals;
    }

    // 4. Customer Reviews
    if (req.body.reviewsData) {
      const parsedReviews = JSON.parse(req.body.reviewsData);
      const reviewFiles = req.files['reviewImages'] || [];
      let imageIndex = 0;

      // Cleanup removed review images
      const retainedReviewUrls = parsedReviews.map(r => r.existingImage).filter(Boolean);
      const reviewsToDelete = settings.customerReviews.filter(old => old.image && !retainedReviewUrls.includes(old.image) && old.imageId);
      for (const img of reviewsToDelete) {
        await imagekit.deleteFile(img.imageId).catch(()=>{});
      }

      const updatedReviews = [];
      for (const rev of parsedReviews) {
        if (rev.hasNewImage && imageIndex < reviewFiles.length) {
          const result = await uploadToImageKit(reviewFiles[imageIndex], 'reviews');
          updatedReviews.push({ image: result.url, imageId: result.fileId, reviewText: rev.text, reviewerName: rev.name, rating: rev.rating || 5 });
          imageIndex++;
        } else {
          const oldMatch = settings.customerReviews.find(o => o.image === rev.existingImage);
          updatedReviews.push({ image: rev.existingImage || '', imageId: oldMatch ? oldMatch.imageId : '', reviewText: rev.text, reviewerName: rev.name, rating: rev.rating || 5 });
        }
      }
      settings.customerReviews = updatedReviews;
    }

    await settings.save();
    res.status(200).json({ message: 'Settings updated successfully', settings });
  } catch (error) {
    console.error("Trust Settings Error:", error);
    res.status(500).json({ message: 'Update failed', error: error.message });
  }
});

module.exports = router;