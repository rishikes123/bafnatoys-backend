const mongoose = require("mongoose");

/**
 * Order item: qty is stored as PIECES (not inners).
 * We add:
 *  - nosPerInner: how many pieces are in one inner (sent from frontend)
 *  - inners: computed number of inners (Math.ceil(qty / nosPerInner))
 *
 * The pre-validate hook computes inners for each item and ensures total.
 */

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name:      { type: String, required: true },
    qty:       { type: Number, required: true },   // pieces (NOT inners)
    price:     { type: Number, required: true },   // price per piece
    image:     { type: String },
    nosPerInner: { type: Number, default: 0 },     // pieces per inner (optional)
    inners:    { type: Number, default: 0 },       // computed inners (rounded up)
  },
  { _id: false }
);

const shippingSchema = new mongoose.Schema(
  {
    address: { type: String, default: "" },
    phone:   { type: String, default: "" },
    email:   { type: String, default: "" },
    notes:   { type: String, default: "" },
    selectedAddressId: { type: mongoose.Schema.Types.ObjectId, ref: "Address" },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customerId:    { type: mongoose.Schema.Types.ObjectId, ref: "Registration", required: true },
    orderNumber:   { type: String, required: true, unique: true },
    items:         { type: [orderItemSchema], default: [] },
    total:         { type: Number, required: true }, // currency (you can recompute if needed)
    paymentMethod: { type: String, enum: ["COD", "ONLINE"], default: "COD" },
    status:        { type: String, enum: ["pending", "processing", "shipped", "delivered", "cancelled"], default: "pending" },
    shipping:      { type: shippingSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// unique index on orderNumber
orderSchema.index({ orderNumber: 1 }, { unique: true });

// helper: safe ceil
const safeCeil = (n) => {
  if (!isFinite(n) || n <= 0) return 0;
  return Math.ceil(n);
};

// pre-validate: compute inners per item, and optionally recompute total if missing/zero
orderSchema.pre("validate", function (next) {
  try {
    // make sure items exist
    if (Array.isArray(this.items)) {
      this.items.forEach((it) => {
        // ensure numeric defaults
        it.qty = Number(it.qty) || 0;
        it.price = Number(it.price) || 0;
        it.nosPerInner = Number(it.nosPerInner) || 0;

        // compute inners:
        // if nosPerInner provided and >0 -> inners = ceil(qty / nosPerInner)
        // else, if nosPerInner missing, try to fallback to 1 (so inners = qty),
        // but better to provide nosPerInner from frontend.
        const perInner = it.nosPerInner > 0 ? it.nosPerInner : 1;
        it.inners = safeCeil(it.qty / perInner);
      });
    }

    // If total is falsy or inconsistent, recompute from items (pieces * price)
    const computedTotal = Array.isArray(this.items)
      ? this.items.reduce((s, it) => s + (Number(it.qty || 0) * Number(it.price || 0)), 0)
      : 0;

    // If total is missing or zero, or differs significantly, set to computedTotal
    if (!this.total || Math.abs(this.total - computedTotal) < 0.0001 || this.total === 0) {
      this.total = computedTotal;
    }

    // Ensure orderNumber exists (pre-validate could set if missing)
    if (!this.orderNumber) {
      this.orderNumber = "ODR" + Math.floor(100000 + Math.random() * 900000);
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
