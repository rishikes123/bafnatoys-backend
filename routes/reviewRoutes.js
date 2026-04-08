const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Order = require('../models/orderModel'); // ✅ Order verify karne ke liye
const Setting = require('../models/settingModel'); // ✅ Time limit (days) fetch karne ke liye

// ──────────────────────────────────────────────────────────────
// ✅ SPECIFIC ROUTES FIRST (To avoid parameter shadowing)
// ──────────────────────────────────────────────────────────────

// 1. GET REVIEWS BY USER - Private/User Specific
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || userId === 'undefined' || userId === 'null') {
      return res.status(400).json({ message: "Invalid User ID provided" });
    }
    const reviews = await Review.find({ userId }).sort({ createdAt: -1 });
    res.json(reviews || []);
  } catch (err) {
    res.status(500).json({ message: "Fetch failed", error: err.message });
  }
});

// 2. Admin Route to list all
router.get('/all/list', async (req, res) => {
  try {
    const reviews = await Review.find().populate('productId', 'name images').sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) { 
    res.status(500).json({ message: 'Error fetching reviews' }); 
  }
});

// ──────────────────────────────────────────────────────────────
// ✅ PARAMETERIZED ROUTES
// ──────────────────────────────────────────────────────────────

// 3. GET REVIEWS BY PRODUCT - Public
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) { 
    res.status(500).json({ message: "Fetch failed" }); 
  }
});

// 4. ADD REVIEW - Protect Fake Reviews (Customers) + Allow Admin Bypass
router.post('/add', async (req, res) => {
  try {
    const { productId, shopName, rating, createdAt, userId, isAdmin } = req.body; 

    if (!isAdmin) {
      if (!userId) {
        return res.status(400).json({ message: "User ID is required to verify purchase." });
      }

      const order = await Order.findOne({
        customerId: userId, 
        'items.productId': productId, 
        status: 'delivered'
      }).sort({ updatedAt: -1 });

      if (!order) {
        return res.status(403).json({ message: "Only verified buyers can rate this product after delivery." });
      }

      const settings = await Setting.findOne();
      const limitDays = settings?.reviewTimeLimitDays || 30;

      const deliveryDate = new Date(order.updatedAt);
      const currentDate = new Date();
      const diffTime = Math.abs(currentDate - deliveryDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (limitDays > 0 && diffDays > limitDays) {
        return res.status(403).json({ message: `Rating window closed. You can only rate within ${limitDays} days of delivery.` });
      }
    }

    const finalShopName = (shopName && shopName.trim() !== "") ? shopName : "Verified Buyer";
    let finalDate = Date.now();
    if (createdAt) finalDate = new Date(createdAt);

    const newReview = new Review({
      productId,
      userId, // ✅ Keep tracking the user
      shopName: finalShopName,
      rating: rating || 5,
      createdAt: finalDate
    });

    await newReview.save();
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ message: 'Validation Failed', error: error.message });
  }
});

// 5. EDIT ROUTE
router.put('/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData.comment;
    if (updateData.createdAt) updateData.createdAt = new Date(updateData.createdAt);

    const updated = await Review.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true });
    res.json(updated);
  } catch (err) { 
    res.status(500).json({ message: "Update failed" }); 
  }
});

// 6. DELETE ROUTE
router.delete('/:id', async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { 
    res.status(500).json({ message: "Delete failed" }); 
  }
});

module.exports = router;