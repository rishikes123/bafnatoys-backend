const mongoose = require("mongoose");

const checkoutAttemptSchema = new mongoose.Schema(
  {
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
    },
    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
      index: true,
    },
    items: {
      type: [mongoose.Schema.Types.Mixed],
      required: true,
      validate: [(items) => Array.isArray(items) && items.length > 0, "Items are required"],
    },
    shippingAddress: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ["COD", "ONLINE"],
      required: true,
    },
    calculation: {
      itemsTotal: { type: Number, required: true },
      shippingCharge: { type: Number, required: true },
      discountAmount: { type: Number, required: true },
      grandTotal: { type: Number, required: true },
      amountToCharge: { type: Number, required: true },
    },
    status: {
      type: String,
      enum: ["created", "processing", "completed", "failed", "expired"],
      default: "created",
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    processingStartedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    recoveryCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Keep recovery/audit data for 90 days.
checkoutAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports =
  mongoose.models.CheckoutAttempt ||
  mongoose.model("CheckoutAttempt", checkoutAttemptSchema);
