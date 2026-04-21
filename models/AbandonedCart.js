// backend/models/AbandonedCart.js
const mongoose = require("mongoose");

/**
 * AbandonedCart
 * -------------
 * One document per customer — their latest cart snapshot.
 * Admin sees these in "Abandoned Carts" page and can recover via WhatsApp.
 *
 * Lifecycle:
 *   - Frontend syncs every cart change (debounced) for logged-in users.
 *   - When cart becomes empty OR order is placed, status flips to "recovered".
 *   - Admin can manually dismiss low-quality leads.
 */

const abandonedItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    quantity: { type: Number, default: 1 },
    image: { type: String, default: "" },
    slug: { type: String, default: "" },
  },
  { _id: false }
);

const whatsappLogSchema = new mongoose.Schema(
  {
    sentAt: { type: Date, default: Date.now },
    template: { type: String, default: "" },
    languageCode: { type: String, default: "en_US" },
    status: {
      type: String,
      enum: ["sent", "failed"],
      default: "sent",
    },
    messageId: { type: String, default: "" }, // Meta wamid
    error: { type: String, default: "" },
    sentBy: { type: String, default: "" }, // admin username
  },
  { _id: false }
);

const abandonedCartSchema = new mongoose.Schema(
  {
    // Link to logged-in customer
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
      unique: true, // one active abandoned cart per user
      index: true,
    },

    // Cached contact info (so admin page is fast — no join needed)
    shopName: { type: String, default: "" },
    mobile: { type: String, default: "" }, // primary OTP mobile
    whatsapp: { type: String, default: "" }, // preferred WhatsApp number (falls back to mobile)

    // Cart snapshot
    items: { type: [abandonedItemSchema], default: [] },
    totalValue: { type: Number, default: 0 },
    itemCount: { type: Number, default: 0 },

    // Activity tracking
    lastActivityAt: { type: Date, default: Date.now, index: true },

    // Status
    status: {
      type: String,
      enum: ["active", "recovered", "dismissed"],
      default: "active",
      index: true,
    },
    recoveredOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    recoveredAt: { type: Date, default: null },

    // WhatsApp recovery history
    whatsappSent: { type: [whatsappLogSchema], default: [] },
    lastWhatsappAt: { type: Date, default: null },
    reminderCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Composite index for admin list queries (status + recency)
abandonedCartSchema.index({ status: 1, lastActivityAt: -1 });

module.exports =
  mongoose.models.AbandonedCart ||
  mongoose.model("AbandonedCart", abandonedCartSchema);
