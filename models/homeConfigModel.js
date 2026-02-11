const mongoose = require("mongoose");

// Schema for individual Trending Sections
const trendingSectionSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { _id: false }
);

// ✅ NEW: Schema for per-product hot deal items
const hotDealItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },

    // discount settings
    // ⚠️ IMPORTANT: Enum includes "NONE" to prevent data loss if no discount is selected
    discountType: { type: String, enum: ["PERCENT", "FLAT", "NONE"], default: "NONE" },
    
    discountValue: { type: Number, default: 0 }, // percent value OR flat amount
    
    // optional override price (if you want to set a fixed deal price directly)
    dealPrice: { type: Number, default: null },

    // per product timer
    endsAt: { type: Date, default: null },

    // enable/disable per item
    enabled: { type: Boolean, default: true },

    // optional badge text
    badge: { type: String, default: "" },
  },
  { _id: false }
);

const homeConfigSchema = new mongoose.Schema(
  {
    // =========================
    // ✅ TRENDING (NEW MULTI SECTIONS)
    // =========================
    trendingSections: { type: [trendingSectionSchema], default: [] },

    // =========================
    // ✅ TRENDING (OLD SUPPORT - For Backward Compatibility)
    // =========================
    trendingTitle: { type: String, default: "Trending Toy" },
    trendingProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    // =========================
    // RIGHT SIDE BANNER
    // =========================
    bannerImage: { type: String, default: "" },
    bannerLink: { type: String, default: "" },

    // =========================
    // POPULAR CATEGORIES
    // =========================
    popularTitle: { type: String, default: "Popular Categories" },
    popularSubtitle: { type: String, default: "Lorem ipsum dolor sit amet consectetur." },
    popularCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],

    // =========================
    // ✅ HOT DEALS (SECTION SETTINGS)
    // =========================
    hotDealsEnabled: { type: Boolean, default: true },
    hotDealsPageEnabled: { type: Boolean, default: true },
    hotDealsTitle: { type: String, default: "Deals Of The Day" },

    // ✅ OLD SUPPORT (global end + ids)
    hotDealsEndsAt: { type: Date, default: null },
    hotDealsProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    // ✅ NEW: per product deals list
    hotDealsItems: { type: [hotDealItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.models.HomeConfig || mongoose.model("HomeConfig", homeConfigSchema);