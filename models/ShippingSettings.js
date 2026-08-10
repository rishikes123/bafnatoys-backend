const mongoose = require('mongoose');

const ShippingSchema = new mongoose.Schema({
  shippingCharge: { type: Number, default: 199 },        // Flat-rate fallback
  freeShippingThreshold: { type: Number, default: 3000 },
  shippingSlabsEnabled: { type: Boolean, default: true },
  shippingSlabs: {
    type: [
      {
        _id: false,
        minAmount: { type: Number, required: true, min: 0 },
        shippingCharge: { type: Number, required: true, min: 0 },
      },
    ],
    default: () => [
      { minAmount: 0, shippingCharge: 199 },
      { minAmount: 1000, shippingCharge: 299 },
      { minAmount: 2000, shippingCharge: 349 },
    ],
  },
  
  // ✅ NEW: Ye field add kiya hai rules store karne ke liye
  discountRules: [
    {
      minAmount: { type: Number, required: true },       // Kitne ki shopping
      discountPercentage: { type: Number, required: true } // Kitna % off
    }
  ]
});

module.exports = mongoose.model('ShippingSettings', ShippingSchema);
