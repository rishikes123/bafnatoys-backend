const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sku: { type: String, required: true, trim: true },
  price: { type: Number, default: 0 },
  description: { type: String, trim: true },
  images: [String],
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  bulkPricing: [
    {
      inner: String,
      qty: { type: Number, min: 1 },
      price: { type: Number, min: 0 },
    },
  ],
  taxFields: {
    type: [String],
    default: [],
  },

  // 👇 Order field for manual sorting
  order: { type: Number, default: 0 },
}, { timestamps: true });

// ✅ Auto-set next order value before saving new product
productSchema.pre('save', async function (next) {
  if (this.isNew) {
    const lastProduct = await mongoose.model('Product').findOne().sort({ order: -1 });
    this.order = lastProduct ? lastProduct.order + 1 : 1;
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
