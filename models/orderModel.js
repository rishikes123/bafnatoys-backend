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
    
    // ✅ UNIT
    unit: { type: String, default: "Piece" }, 

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
      // Added 'returned' to enum to handle full return lifecycle
      enum: ["pending", "processing", "shipped", "delivered", "cancelled", "returned"],
      default: "pending",
    },

    // ✅ FIELD TO TRACK WHO CANCELLED (Customer or Admin)
    cancelledBy: { 
      type: String, // Value will be "Customer" or "Admin"
      default: null 
    },

    /* ✅ SHIPPING INTEGRATION FIELDS */
    isShipped: { type: Boolean, default: false },
    trackingId: { type: String, default: "" },
    courierName: { type: String, default: "" },

    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
    },

    /* ============================================================
       ✅ RETURN REQUEST SYSTEM (B2B Rules)
       Only for Damaged/Wrong Product + Image/Video Uploads
    ============================================================ */
    returnRequest: {
      isRequested: { type: Boolean, default: false }, // Filter karne ke liye easy hoga
      status: { 
        type: String, 
        enum: ['Pending', 'Approved', 'Rejected'], 
        default: 'Pending' 
      },
      reason: { 
        type: String, 
        // Sirf ye do reasons allowed hain strict B2B rules ke hisab se
        enum: ['Damaged Product', 'Wrong Product'] 
      },
      description: { type: String }, // User detail me likh sake kya damage hai
      
      // Cloudinary URLs store karne ke liye
      proofImages: [{ type: String }], // Multiple images allowed
      proofVideo: { type: String },    // Single video URL
      
      adminComment: { type: String }, // Admin rejection/approval reason likh sake
      requestDate: { type: Date }
    }
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

// Check if model already exists to prevent overwrite error in some environments
module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);