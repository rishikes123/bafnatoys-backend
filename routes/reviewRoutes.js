const express = require('express');
const router = express.Router();
const Review = require('../models/Review');

// 1. GET REVIEWS BY PRODUCT - Public (Guest users can access)
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) { 
    res.status(500).json({ message: "Fetch failed" }); 
  }
});

// 2. ADD REVIEW - Protected logic handled by frontend hidden form
router.post('/add', async (req, res) => {
  try {
    const { productId, shopName, rating, comment } = req.body;
    const finalShopName = (shopName && shopName.trim() !== "") ? shopName : "Guest Shop";

    const newReview = new Review({
      productId,
      shopName: finalShopName,
      rating: rating || 5,
      comment
    });

    await newReview.save();
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ message: 'Validation Failed', error: error.message });
  }
});

// 3. EDIT & DELETE ROUTES
router.put('/:id', async (req, res) => {
  try {
    const updated = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json({ message: "Update failed" }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: "Delete failed" }); }
});

// Admin Route to list all
router.get('/all/list', async (req, res) => {
  try {
    const reviews = await Review.find().populate('productId', 'name').sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) { res.status(500).json({ message: 'Error fetching reviews' }); }
});

module.exports = router;