const mongoose = require("mongoose");

/* ================= ORDER ITEMS ================= */
const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    innerQty: { type: Number, required: true },
    inners: { type: Number, required: true },
    price: { type: Number, required: true },
    image: { type: String },
  },
  { _id: false }
);

/* ================= SHIPPING ADDRESS ================= */
const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    street: { type: String, required: true },
    area: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    type: { type: String, default: "Home" },
  },
  { _id: false }
);

/* ================= MAIN ORDER ================= */
const orderSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
    },
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    items: {
      type: [orderItemSchema],
      default: [],
    },
    itemsPrice: { type: Number, default: 0 },
    shippingPrice: { type: Number, default: 0 },
    total: {
      type: Number,
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ["COD", "ONLINE"],
      default: "COD",
    },
    advancePaid: {
      type: Number,
      default: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    /* ✅ SHIPPING INTEGRATION FIELDS ADDED */
    isShipped: { type: Boolean, default: false },
    trackingId: { type: String, default: "" },
    courierName: { type: String, default: "" },

    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
    },
  },
  { timestamps: true }
);

/* ================= INDEX ================= */
orderSchema.index({ orderNumber: 1 }, { unique: true });

/* ================= AUTO ORDER NUMBER ================= */
orderSchema.pre("validate", function (next) {
  if (!this.orderNumber) {
    this.orderNumber = "ODR" + Math.floor(100000 + Math.random() * 900000);
  }

  this.remainingAmount = Math.max(
    (this.total || 0) - (this.advancePaid || 0),
    0
  );

  next();
});

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);