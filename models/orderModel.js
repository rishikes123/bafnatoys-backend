// backend/models/orderModel.js
const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name:      { type: String, required: true },
    qty:       { type: Number, required: true },   // pieces
    price:     { type: Number, required: true },   // price per piece
    image:     { type: String },
  },
  { _id: false }
);

// Shipping (address/phone/email/notes) – stored with the order
const shippingSchema = new mongoose.Schema(
  {
    address: { type: String, default: "" },
    phone:   { type: String, default: "" },
    email:   { type: String, default: "" },
    notes:   { type: String, default: "" },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customerId:    { type: mongoose.Schema.Types.ObjectId, ref: "Registration", required: true },
    orderNumber:   { type: String, required: true, unique: true },
    items:         { type: [orderItemSchema], default: [] },
    total:         { type: Number, required: true },
    paymentMethod: { type: String, enum: ["COD", "ONLINE"], default: "COD" },
    status:        { type: String, enum: ["pending", "processing", "shipped", "delivered", "cancelled"], default: "pending" },
    shipping:      { type: shippingSchema, default: () => ({}) }, // ⬅️ added
  },
  { timestamps: true }
);

// Ensure proper unique index
orderSchema.index({ orderNumber: 1 }, { unique: true });

// Generate readable order number before validation (so unique index applies)
orderSchema.pre("validate", function (next) {
  if (!this.orderNumber) {
    this.orderNumber = "ODR" + Math.floor(100000 + Math.random() * 900000);
  }
  next();
});

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
