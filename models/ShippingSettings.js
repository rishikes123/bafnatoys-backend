const mongoose = require('mongoose');

const ShippingSchema = new mongoose.Schema({
  shippingCharge: { type: Number, default: 250 },        // Default charge
  freeShippingThreshold: { type: Number, default: 5000 }, // Isse uper free
  
  // ✅ NEW: Ye field add kiya hai rules store karne ke liye
  discountRules: [
    {
      minAmount: { type: Number, required: true },       // Kitne ki shopping
      discountPercentage: { type: Number, required: true } // Kitna % off
    }
  ]
});

module.exports = mongoose.model('ShippingSettings', ShippingSchema);