const mongoose = require("mongoose");
const crypto = require("crypto");

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
    unit: { type: String, default: "Piece" },
    innerQty: { type: Number, required: true },
    inners: { type: Number, required: true },
    price: { type: Number, required: true },
    mrp: { type: Number, default: 0 },
    image: { type: String },
  },
  { _id: false }
);

/* ================= SHIPPING ADDRESS ================= */
const shippingAddressSchema = new mongoose.Schema(
  {
    shopName: { type: String, default: "" },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    street: { type: String, required: true },
    area: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    type: { type: String, default: "Home" },
    gstNumber: { type: String, default: "" },
    isDifferentShipping: { type: Boolean, default: false },
    shippingStreet: { type: String, default: "" },
    shippingArea: { type: String, default: "" },
    shippingPincode: { type: String, default: "" },
    shippingCity: { type: String, default: "" },
    shippingState: { type: String, default: "" },
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
      enum: ["pending", "processing", "shipped", "delivered", "cancelled", "returned"],
      default: "pending",
    },
    cancelledBy: {
      type: String,
      default: null,
    },
    isShipped: { type: Boolean, default: false },
    trackingId: { type: String, default: "" },
    courierName: { type: String, default: "" },
    packingDetails: {
      type: [
        {
          boxType: { type: String, enum: ["A28", "A06", "A08", "A31", "A18"] },
          quantity: { type: Number, default: 0 },
          totalWeight: { type: Number, default: 0 },
        }
      ],
      default: []
    },
    trackingToken: { type: String, default: "" },
    wa: {
      orderConfirmedSent: { type: Boolean, default: false },
      trackingSent: { type: Boolean, default: false },
      lastError: { type: String, default: "" },
      lastSentAt: { type: Date, default: null },
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
    },
    returnRequest: {
      isRequested: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ["Pending", "Approved", "Rejected"],
        default: "Pending",
      },
      reason: {
        type: String,
        enum: ["Damaged Product", "Wrong Product"],
      },
      description: { type: String },
      proofImages: [{ type: String }],
      proofVideo: { type: String },
      adminComment: { type: String },
      requestDate: { type: Date },
    },
  },
  { timestamps: true }
);

/* ================= INDEX ================= */
orderSchema.index({ orderNumber: 1 }, { unique: true });

/* ================= AUTO ORDER NUMBER + TOKEN + AMOUNT ================= */
orderSchema.pre("validate", async function (next) {
  if (!this.orderNumber) {
    const lastOrder = await this.constructor.findOne().sort({ createdAt: -1 });
    let nextNum = 1001001; 

    if (lastOrder && lastOrder.orderNumber) {
      const lastNumber = parseInt(lastOrder.orderNumber.replace("ODR", ""), 10);
      if (!isNaN(lastNumber) && lastNumber >= 1001000) {
        nextNum = lastNumber + 1;
      }
    }
    
    this.orderNumber = "ODR" + nextNum;
  }

  if (!this.trackingToken) {
    this.trackingToken = crypto.randomBytes(16).toString("hex");
  }

  this.remainingAmount = Math.max((this.total || 0) - (this.advancePaid || 0), 0);
  next();
});

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);