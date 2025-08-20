const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sku: { type: String, required: true, trim: true },
  price: Number,
  description: String,
  images: [String],
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  bulkPricing: [
    {
      inner: String,
      qty: Number,
      price: Number
    }
  ],
  taxFields: {                     // ⭐️ Yeh line add karo
    type: [String],
    default: []
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
