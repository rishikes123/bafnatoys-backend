const express = require('express');
const router = express.Router();
const Review = require('../models/Review');

// 1. GET REVIEWS BY PRODUCT - Public
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) { 
    res.status(500).json({ message: "Fetch failed" }); 
  }
});

// 2. ADD REVIEW - Protected logic handled by frontend
router.post('/add', async (req, res) => {
  try {
    const { productId, shopName, rating, comment, createdAt } = req.body;
    const finalShopName = (shopName && shopName.trim() !== "") ? shopName : "Guest Shop";

    // ✅ FIX: Force parse the date string to actual Date object
    let finalDate = Date.now();
    if (createdAt) {
      finalDate = new Date(createdAt);
    }

    const newReview = new Review({
      productId,
      shopName: finalShopName,
      rating: rating || 5,
      comment,
      createdAt: finalDate // ✅ Saved with manual date
    });

    await newReview.save();
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ message: 'Validation Failed', error: error.message });
  }
});

// 3. EDIT ROUTE - Update existing review
router.put('/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    
    // ✅ FIX: Force update the date using proper Date object
    if (updateData.createdAt) {
      updateData.createdAt = new Date(updateData.createdAt);
    }

    // ✅ FIX: Used $set to force Mongoose to update the date field
    const updated = await Review.findByIdAndUpdate(
      req.params.id, 
      { $set: updateData }, 
      { new: true }
    );
    res.json(updated);
  } catch (err) { 
    console.error(err);
    res.status(500).json({ message: "Update failed" }); 
  }
});

// 4. DELETE ROUTE
router.delete('/:id', async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { 
    res.status(500).json({ message: "Delete failed" }); 
  }
});

// 5. Admin Route to list all
router.get('/all/list', async (req, res) => {
  try {
    const reviews = await Review.find().populate('productId', 'name images').sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) { 
    res.status(500).json({ message: 'Error fetching reviews' }); 
  }
});

module.exports = router;