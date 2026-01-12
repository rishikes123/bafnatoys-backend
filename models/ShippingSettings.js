const mongoose = require('mongoose');

const ShippingSchema = new mongoose.Schema({
  shippingCharge: { type: Number, default: 250 },       // Default charge
  freeShippingThreshold: { type: Number, default: 5000 } // Isse uper free
});

module.exports = mongoose.model('ShippingSettings', ShippingSchema);