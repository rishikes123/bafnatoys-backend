const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  productId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product', 
    required: true 
  },
  userId: { // ✅ Added to track which customer is giving the rating
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Registration' // Aapke orderModel ke hisaab se ref 'Registration' hai
  },
  shopName: { type: String, required: true }, 
  rating: { type: Number, required: true, min: 1, max: 5 },
  // ❌ Comment field is completely removed
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Review', reviewSchema);