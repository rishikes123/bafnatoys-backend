const mongoose = require("mongoose");

// Schema for individual Trending Sections
const trendingSectionSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { _id: false }
);

// Schema for per-product hot deal items
const hotDealItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    discountType: { type: String, enum: ["PERCENT", "FLAT", "NONE"], default: "NONE" },
    discountValue: { type: Number, default: 0 },
    dealPrice: { type: Number, default: null },
    endsAt: { type: Date, default: null },
    enabled: { type: Boolean, default: true },
    badge: { type: String, default: "" },
  },
  { _id: false }
);

// Promo banner schema (2 banners)
const promoBannerSchema = new mongoose.Schema(
  {
    image: { type: String, default: "" },
    link: { type: String, default: "" },
  },
  { _id: false }
);

// Promo config schema
const promoSchema = new mongoose.Schema(
  {
    sideBanners: { type: [promoBannerSchema], default: [] },
    bestSellingProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    onSaleProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { _id: false }
);

const homeConfigSchema = new mongoose.Schema(
  {
    // TRENDING (NEW MULTI SECTIONS)
    trendingSections: { type: [trendingSectionSchema], default: [] },

    // TRENDING (OLD SUPPORT)
    trendingTitle: { type: String, default: "Trending Toy" },
    trendingProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    // RIGHT SIDE BANNER
    bannerImage: { type: String, default: "" },
    bannerLink: { type: String, default: "" },

    // NEW: HOME PROMO SECTION
    promo: { type: promoSchema, default: () => ({}) },

    // POPULAR CATEGORIES
    popularTitle: { type: String, default: "Popular Categories" },
    popularSubtitle: { type: String, default: "Lorem ipsum dolor sit amet consectetur." },
    popularCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],

    // HOT DEALS
    hotDealsEnabled: { type: Boolean, default: true },
    hotDealsPageEnabled: { type: Boolean, default: true },
    hotDealsTitle: { type: String, default: "Deals Of The Day" },

    // OLD SUPPORT
    hotDealsEndsAt: { type: Date, default: null },
    hotDealsProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],

    // NEW: per product deals list
    hotDealsItems: { type: [hotDealItemSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.models.HomeConfig || mongoose.model("HomeConfig", homeConfigSchema);
