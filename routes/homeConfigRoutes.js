const express = require("express");
const router = express.Router();

const HomeConfig = require("../models/homeConfigModel");
const Product = require("../models/Product");
const Category = require("../models/categoryModel");

const safeArr = (v) => (Array.isArray(v) ? v : []);
const safeStr = (v, d = "") => (typeof v === "string" ? v : d);
const safeNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const normalizeTrendingSections = (v) => {
  const sections = safeArr(v).map((s) => ({
    title: safeStr(s?.title, ""),
    productIds: safeArr(s?.productIds).map(String),
  }));
  return sections.filter((s) => s.title.trim() || s.productIds.length > 0);
};

const normalizeHotDealsItems = (v) => {
  return safeArr(v)
    .map((it) => {
      let dType = "NONE";
      if (it?.discountType) {
         const t = String(it.discountType).toUpperCase();
         if (t === "PERCENT") dType = "PERCENT";
         if (t === "FLAT") dType = "FLAT";
      }

      return {
        productId: it?.productId ? String(it.productId) : "",
        discountType: dType,
        discountValue: safeNum(it?.discountValue, 0),
        dealPrice: it?.dealPrice === null || it?.dealPrice === undefined ? null : safeNum(it?.dealPrice, null),
        endsAt: it?.endsAt ? new Date(it.endsAt) : null,
        enabled: typeof it?.enabled === "boolean" ? it.enabled : true,
        badge: safeStr(it?.badge, ""),
      };
    })
    .filter((it) => it.productId);
};

// 🔥 NEW HELPER: Apply Deals Logic (Same as productRoutes.js)
const applyDealsToProductsList = (productsList, config) => {
    if (!productsList || !Array.isArray(productsList) || !config) return productsList;

    // 1. Create Deal Map
    const dealMap = {};
    if (config.hotDealsItems) {
        const now = new Date();
        config.hotDealsItems.forEach((item) => {
            if (item.enabled && item.productId && item.endsAt) {
                const end = new Date(item.endsAt);
                if (end > now) {
                    dealMap[item.productId.toString()] = item;
                }
            }
        });
    }

    // 2. Apply to Products
    return productsList.map((prod) => {
        // Ensure it's a plain object
        const p = prod._doc ? prod.toObject() : { ...prod }; 
        const prodId = p._id.toString();
        const deal = dealMap[prodId];

        if (deal) {
            // A. Attach Timer
            p.sale_end_time = deal.endsAt;

            // B. Apply Discount
            if (deal.discountType && deal.discountType !== "NONE" && deal.discountValue > 0) {
                
                // Remove Bulk Pricing so UI shows Deal Price
                p.bulkPricing = [];

                if (!p.mrp || p.mrp <= p.price) {
                    p.mrp = p.price; 
                }

                let basePrice = p.price;
                let newPrice = basePrice;
                const dType = deal.discountType.toUpperCase();

                if (dType === "PERCENT") {
                    const discountAmount = (basePrice * deal.discountValue) / 100;
                    newPrice = basePrice - discountAmount;
                } else if (dType === "FLAT") {
                    newPrice = basePrice - deal.discountValue;
                }

                p.price = Math.max(0, Math.round(newPrice));
            }
        }
        return p;
    });
};

// ✅ GET Route (Updated to use applyDealsToProductsList)
router.get("/", async (_req, res) => {
  try {
    const cfg = await HomeConfig.findOne().lean();

    if (!cfg) {
      return res.json({ /* ... default empty state ... */ });
    }

    const trendingIds = safeArr(cfg.trendingProductIds).map((x) => String(x));
    const popularIds = safeArr(cfg.popularCategoryIds).map((x) => String(x));
    const hotDealIds = safeArr(cfg.hotDealsProductIds).map((x) => String(x));

    const hotDealsItems = normalizeHotDealsItems(cfg.hotDealsItems);
    const hotItemIds = hotDealsItems.map((x) => x.productId);
    const trendingSections = normalizeTrendingSections(cfg.trendingSections);
    const sectionAllIds = trendingSections.flatMap((s) => s.productIds);

    const allProductIds = Array.from(new Set([...trendingIds, ...sectionAllIds, ...hotDealIds, ...hotItemIds]));

    const [productsRaw, catsRaw] = await Promise.all([
      allProductIds.length ? Product.find({ _id: { $in: allProductIds } }).lean() : Promise.resolve([]),
      popularIds.length ? Category.find({ _id: { $in: popularIds } }).lean() : Promise.resolve([]),
    ]);

    // 🔥 VITAL STEP: Apply Deals Logic Here!
    const productsProcessed = applyDealsToProductsList(productsRaw, cfg);

    const productMap = new Map(productsProcessed.map((p) => [String(p._id), p]));
    const catMap = new Map(catsRaw.map((c) => [String(c._id), c]));

    const products = trendingIds.map((id) => productMap.get(id)).filter(Boolean);
    const popularCategories = popularIds.map((id) => catMap.get(id)).filter(Boolean);

    const trendingSectionsResolved = trendingSections.map((s) => ({
      title: s.title,
      productIds: s.productIds,
      products: s.productIds.map((id) => productMap.get(id)).filter(Boolean),
    }));

    const hotDealsProducts = hotDealIds.map((id) => productMap.get(id)).filter(Boolean);

    const hotDealsItemsResolved = hotDealsItems
      .map((it) => ({
        ...it,
        endsAt: it.endsAt ? it.endsAt.toISOString() : null,
        product: productMap.get(it.productId) || null,
      }))
      .filter((x) => x.product);

    return res.json({
      trendingSections: trendingSectionsResolved,
      trendingTitle: safeStr(cfg.trendingTitle, "Trending Toy"),
      trendingProductIds: trendingIds,
      products, // This now contains discounted products
      bannerImage: safeStr(cfg.bannerImage, ""),
      bannerLink: safeStr(cfg.bannerLink, ""),
      popularTitle: safeStr(cfg.popularTitle, "Popular Categories"),
      popularSubtitle: safeStr(cfg.popularSubtitle, "Lorem ipsum dolor sit amet consectetur."),
      popularCategoryIds: popularIds,
      popularCategories,
      hotDealsEnabled: cfg.hotDealsEnabled !== false,
      hotDealsPageEnabled: cfg.hotDealsPageEnabled !== false,
      hotDealsTitle: safeStr(cfg.hotDealsTitle, "Deals Of The Day"),
      hotDealsEndsAt: cfg.hotDealsEndsAt || null,
      hotDealsProductIds: hotDealIds,
      hotDealsProducts,
      hotDealsItems: hotDealsItems.map((it) => ({
        ...it,
        endsAt: it.endsAt ? it.endsAt.toISOString() : null,
      })),
      hotDealsItemsResolved,
    });
  } catch (err) {
    console.error("Home Config Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// ✅ PUT Route (Same as before)
router.put("/", async (req, res) => {
  try {
    const payload = {
      trendingSections: normalizeTrendingSections(req.body.trendingSections),
      trendingTitle: safeStr(req.body.trendingTitle, "Trending Toy"),
      trendingProductIds: safeArr(req.body.trendingProductIds),
      bannerImage: safeStr(req.body.bannerImage, ""),
      bannerLink: safeStr(req.body.bannerLink, ""),
      popularTitle: safeStr(req.body.popularTitle, "Popular Categories"),
      popularSubtitle: safeStr(req.body.popularSubtitle, "Lorem ipsum dolor sit amet consectetur."),
      popularCategoryIds: safeArr(req.body.popularCategoryIds),
      hotDealsEnabled: req.body.hotDealsEnabled !== false,
      hotDealsPageEnabled: req.body.hotDealsPageEnabled !== false,
      hotDealsTitle: safeStr(req.body.hotDealsTitle, "Deals Of The Day"),
      hotDealsEndsAt: req.body.hotDealsEndsAt ? new Date(req.body.hotDealsEndsAt) : null,
      hotDealsProductIds: safeArr(req.body.hotDealsProductIds),
      hotDealsItems: normalizeHotDealsItems(req.body.hotDealsItems),
    };

    const saved = await HomeConfig.findOneAndUpdate({}, { $set: payload }, { new: true, upsert: true }).lean();
    res.json(saved);
  } catch (err) {
    console.error("Save Config Error:", err);
    res.status(500).json({ message: "Save failed" });
  }
});

// ✅ POST Route (Same as before)
router.post("/", async (req, res) => {
  try {
    const payload = {
      trendingSections: normalizeTrendingSections(req.body.trendingSections),
      trendingTitle: safeStr(req.body.trendingTitle, "Trending Toy"),
      trendingProductIds: safeArr(req.body.trendingProductIds),
      bannerImage: safeStr(req.body.bannerImage, ""),
      bannerLink: safeStr(req.body.bannerLink, ""),
      popularTitle: safeStr(req.body.popularTitle, "Popular Categories"),
      popularSubtitle: safeStr(req.body.popularSubtitle, "Lorem ipsum dolor sit amet consectetur."),
      popularCategoryIds: safeArr(req.body.popularCategoryIds),
      hotDealsEnabled: req.body.hotDealsEnabled !== false,
      hotDealsPageEnabled: req.body.hotDealsPageEnabled !== false,
      hotDealsTitle: safeStr(req.body.hotDealsTitle, "Deals Of The Day"),
      hotDealsEndsAt: req.body.hotDealsEndsAt ? new Date(req.body.hotDealsEndsAt) : null,
      hotDealsProductIds: safeArr(req.body.hotDealsProductIds),
      hotDealsItems: normalizeHotDealsItems(req.body.hotDealsItems),
    };

    const saved = await HomeConfig.findOneAndUpdate({}, { $set: payload }, { new: true, upsert: true }).lean();
    res.json(saved);
  } catch (err) {
    console.error("Create Config Error:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;