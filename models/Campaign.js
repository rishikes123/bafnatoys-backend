// backend/models/Campaign.js
// Stores bulk WhatsApp campaigns + per-recipient message status.
const mongoose = require("mongoose");

const messageLogSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    name: { type: String, default: "" }, // customer/shop name if known
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration" }, // if from DB
    status: {
      type: String,
      enum: ["queued", "sent", "failed", "delivered", "read"],
      default: "queued",
    },
    messageId: { type: String, default: "" },
    error: { type: String, default: "" },
    attemptedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    audienceType: {
      type: String,
      enum: ["all", "active30", "active90", "recent", "excel", "manual"],
      default: "all",
    },
    templateName: { type: String, required: true },
    languageCode: { type: String, default: "en_US" },
    // Flexible {{1}}, {{2}}, ... {{N}} body variables
    bodyVariables: { type: [String], default: [] },
    // Optional header (for product image/video templates)
    headerType: { type: String, enum: ["none", "text", "image", "video", "document"], default: "none" },
    headerValue: { type: String, default: "" }, // URL for image/video or text

    // Optional context (if sent for a product / offer)
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    offerNote: { type: String, default: "" },

    // Stats (denormalized for quick list view)
    totalRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    queuedCount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["draft", "running", "completed", "completed_with_errors", "cancelled"],
      default: "draft",
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },

    messages: { type: [messageLogSchema], default: [] },

    createdBy: { type: String, default: "" }, // admin username
  },
  { timestamps: true }
);

campaignSchema.index({ createdAt: -1 });
campaignSchema.index({ status: 1 });

module.exports =
  mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
