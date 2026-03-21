const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Order = require('../models/orderModel'); // ✅ Order verify karne ke liye
const Setting = require('../models/settingModel'); // ✅ Time limit (days) fetch karne ke liye

// 1. GET REVIEWS BY PRODUCT - Public
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) { 
    res.status(500).json({ message: "Fetch failed" }); 
  }
});

// 2. ADD REVIEW - Protect Fake Reviews (Customers) + Allow Admin Bypass
router.post('/add', async (req, res) => {
  try {
    // ❌ Comment hata diya gaya hai
    const { productId, shopName, rating, createdAt, userId, isAdmin } = req.body; 

    // ==============================================================
    // ✅ LOGIC FOR REAL CUSTOMERS (App Users)
    // ==============================================================
    if (!isAdmin) {
      if (!userId) {
        return res.status(400).json({ message: "User ID is required to verify purchase." });
      }

      // Check if user has an order with status 'delivered' for this product
      const order = await Order.findOne({
        customerId: userId, 
        'items.productId': productId, 
        status: 'delivered'
      }).sort({ updatedAt: -1 }); // Get the latest one

      if (!order) {
        return res.status(403).json({ message: "Only verified buyers can rate this product after delivery." });
      }

      // Fetch Time Limit (Days) from Admin Settings
      const settings = await Setting.findOne();
      const limitDays = settings?.reviewTimeLimitDays || 30; // Default 30 days

      // Calculate days passed since delivery
      const deliveryDate = new Date(order.updatedAt);
      const currentDate = new Date();
      const diffTime = Math.abs(currentDate - deliveryDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Limit = 0 means NO LIMIT. Otherwise check if diffDays > limitDays
      if (limitDays > 0 && diffDays > limitDays) {
        return res.status(403).json({ message: `Rating window closed. You can only rate within ${limitDays} days of delivery.` });
      }
    }

    // ==============================================================
    // ✅ COMMON SAVE LOGIC (For Admin + Customers)
    // ==============================================================
    const finalShopName = (shopName && shopName.trim() !== "") ? shopName : "Verified Buyer";

    // Date Logic: Force parse the date string to actual Date object
    let finalDate = Date.now();
    if (createdAt) {
      finalDate = new Date(createdAt);
    }

    const newReview = new Review({
      productId,
      shopName: finalShopName,
      rating: rating || 5,
      // ❌ Comment property nahi hai
      createdAt: finalDate // Saved with manual/current date
    });

    await newReview.save();
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ message: 'Validation Failed', error: error.message });
  }
});

// 3. EDIT ROUTE - Update existing review (Admin use karega)
router.put('/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    
    // ❌ Safety check: agar frontend se galti se comment aa jaye toh use hata do
    delete updateData.comment;

    // Force update the date using proper Date object
    if (updateData.createdAt) {
      updateData.createdAt = new Date(updateData.createdAt);
    }

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