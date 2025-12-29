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

    // Total pieces
    qty: { type: Number, required: true },

    // Pieces per inner
    innerQty: { type: Number, required: true },

    // Total inners selected
    inners: { type: Number, required: true },

    // Price per piece
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

    total: {
      type: Number,
      required: true,
    },

    /* ===== PAYMENT MODE ===== */
    paymentMode: {
      type: String,
      enum: ["COD", "ONLINE"],
      default: "COD",
    },

    /* ===== COD ADVANCE SUPPORT ===== */
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
    this.orderNumber =
      "ODR" + Math.floor(100000 + Math.random() * 900000);
  }

  // Auto-calc remaining amount
  this.remainingAmount = Math.max(
    (this.total || 0) - (this.advancePaid || 0),
    0
  );

  next();
});

module.exports =
  mongoose.models.Order || mongoose.model("Order", orderSchema);
