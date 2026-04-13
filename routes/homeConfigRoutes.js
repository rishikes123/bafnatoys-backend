const express = require("express");
const router = express.Router();

const HomeConfig = require("../models/homeConfigModel");
const Product = require("../models/Product");
const Category = require("../models/categoryModel");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

const safeArr = (v) => (Array.isArray(v) ? v : []);
const safeStr = (v, d = "") => (typeof v === "string" ? v : d);
const safeNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* =========================
   NORMALIZERS
========================= */

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
        dealPrice:
          it?.dealPrice === null || it?.dealPrice === undefined
            ? null
            : safeNum(it?.dealPrice, null),
        endsAt: it?.endsAt ? new Date(it.endsAt) : null,
        enabled: typeof it?.enabled === "boolean" ? it.enabled : true,
        badge: safeStr(it?.badge, ""),
      };
    })
    .filter((it) => it.productId);
};

// ✅ PROMO NORMALIZER (IDs only store)
const normalizePromo = (v) => {
  const p = v || {};
  return {
    sideBanners: safeArr(p.sideBanners)
      .slice(0, 2)
      .map((b) => ({
        image: safeStr(b?.image, ""),
        link: safeStr(b?.link, ""),
      })),

    bestSellingProductIds: safeArr(p.bestSellingProductIds)
      .map(String)
      .slice(0, 4),

    onSaleProductIds: safeArr(p.onSaleProductIds)
      .map(String)
      .slice(0, 4),
  };
};

/* =========================
   APPLY DEALS LOGIC
========================= */

const applyDealsToProductsList = (productsList, config) => {
  if (!productsList || !Array.isArray(productsList) || !config)
    return productsList;

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

  return productsList.map((prod) => {
    const p = { ...prod };
    const prodId = p._id.toString();
    const deal = dealMap[prodId];

    if (deal) {
      p.sale_end_time = deal.endsAt;

      if (deal.discountType && deal.discountType !== "NONE" && deal.discountValue > 0) {
        p.bulkPricing = [];
        if (!p.mrp || p.mrp <= p.price) p.mrp = p.price;

        let newPrice = p.price;
        const dType = String(deal.discountType).toUpperCase();

        if (dType === "PERCENT") newPrice = p.price - (p.price * deal.discountValue) / 100;
        else if (dType === "FLAT") newPrice = p.price - deal.discountValue;

        p.price = Math.max(0, Math.round(newPrice));
      }
    }
    return p;
  });
};

/* =========================
   GET (✅ FIXED: return IDs + resolved products)
========================= */

router.get("/", async (_req, res) => {
  try {
    const cfg = await HomeConfig.findOne().lean();
    if (!cfg) return res.json({});

    const trendingIds = safeArr(cfg.trendingProductIds).map(String);
    const popularIds = safeArr(cfg.popularCategoryIds).map(String);
    const hotDealIds = safeArr(cfg.hotDealsProductIds).map(String);

    const promo = normalizePromo(cfg.promo); // ✅ always IDs here
    const promoProductIds = [...promo.bestSellingProductIds, ...promo.onSaleProductIds];

    const hotDealsItems = normalizeHotDealsItems(cfg.hotDealsItems);
    const hotItemIds = hotDealsItems.map((x) => x.productId);

    const trendingSections = normalizeTrendingSections(cfg.trendingSections);
    const sectionAllIds = trendingSections.flatMap((s) => s.productIds);

    const allProductIds = Array.from(
      new Set([
        ...trendingIds,
        ...sectionAllIds,
        ...hotDealIds,
        ...hotItemIds,
        ...promoProductIds,
      ])
    );

    const [productsRaw, catsRaw] = await Promise.all([
      allProductIds.length ? Product.find({ _id: { $in: allProductIds } }).lean() : [],
      popularIds.length ? Category.find({ _id: { $in: popularIds } }).lean() : [],
    ]);

    const productsProcessed = applyDealsToProductsList(productsRaw, cfg);

    const productMap = new Map(productsProcessed.map((p) => [String(p._id), p]));
    const catMap = new Map(catsRaw.map((c) => [String(c._id), c]));

    // ✅ resolved lists
    const bestSellingProducts = promo.bestSellingProductIds.map((id) => productMap.get(id)).filter(Boolean);
    const onSaleProducts = promo.onSaleProductIds.map((id) => productMap.get(id)).filter(Boolean);

    return res.json({
      trendingSections: trendingSections.map((s) => ({
        title: s.title,
        productIds: s.productIds,
        products: s.productIds.map((id) => productMap.get(id)).filter(Boolean),
      })),

      bannerImage: safeStr(cfg.bannerImage, ""),
      bannerLink: safeStr(cfg.bannerLink, ""),

      popularTitle: safeStr(cfg.popularTitle, "Popular Categories"),
      popularSubtitle: safeStr(cfg.popularSubtitle, ""),
      popularCategoryIds: popularIds,
      popularCategories: popularIds.map((id) => catMap.get(id)).filter(Boolean),

      hotDealsEnabled: cfg.hotDealsEnabled !== false,
      hotDealsPageEnabled: cfg.hotDealsPageEnabled !== false,
      hotDealsTitle: safeStr(cfg.hotDealsTitle, "Deals Of The Day"),
      hotDealsItems: hotDealsItems.map((it) => ({
        ...it,
        endsAt: it.endsAt ? it.endsAt.toISOString() : null,
      })),

      // ✅ Resolved products for Hot Deals screen (Includes minOrderQty)
      hotDealsItemsResolved: hotDealsItems.map((it) => ({
        ...it,
        product: productMap.get(String(it.productId)),
        endsAt: it.endsAt ? it.endsAt.toISOString() : null,
      })).filter(it => it.product),

      // ✅ IMPORTANT: OLD ko हटाया नहीं, NEW add किया
      promo: {
        sideBanners: promo.sideBanners,

        // ✅ IDs (ADMIN UI needs this)
        bestSellingProductIds: promo.bestSellingProductIds,
        onSaleProductIds: promo.onSaleProductIds,

        // ✅ resolved objects (HOME UI can use this)
        bestSellingProducts,
        onSaleProducts,
      },
    });
  } catch (err) {
    console.error("Home Config Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* =========================
   SAVE (PUT + POST SAME)
========================= */

const buildPayload = (body) => ({
  trendingSections: normalizeTrendingSections(body.trendingSections),
  trendingTitle: safeStr(body.trendingTitle, "Trending Toy"),
  trendingProductIds: safeArr(body.trendingProductIds),

  bannerImage: safeStr(body.bannerImage, ""),
  bannerLink: safeStr(body.bannerLink, ""),

  popularTitle: safeStr(body.popularTitle, "Popular Categories"),
  popularSubtitle: safeStr(body.popularSubtitle, ""),
  popularCategoryIds: safeArr(body.popularCategoryIds),

  hotDealsEnabled: body.hotDealsEnabled !== false,
  hotDealsPageEnabled: body.hotDealsPageEnabled !== false,
  hotDealsTitle: safeStr(body.hotDealsTitle, "Deals Of The Day"),
  hotDealsEndsAt: body.hotDealsEndsAt ? new Date(body.hotDealsEndsAt) : null,
  hotDealsProductIds: safeArr(body.hotDealsProductIds),
  hotDealsItems: normalizeHotDealsItems(body.hotDealsItems),

  // ✅ promo save
  promo: normalizePromo(body.promo),
});

router.put("/", adminProtect, isAdmin, async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    const saved = await HomeConfig.findOneAndUpdate(
      {},
      { $set: payload },
      { new: true, upsert: true }
    ).lean();

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");

    res.json(saved);
  } catch (err) {
    console.error("Save Config Error:", err);
    res.status(500).json({ message: "Save failed" });
  }
});

router.post("/", adminProtect, isAdmin, async (req, res) => {
  try {
    const payload = buildPayload(req.body);
    const saved = await HomeConfig.findOneAndUpdate(
      {},
      { $set: payload },
      { new: true, upsert: true }
    ).lean();

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");

    res.json(saved);
  } catch (err) {
    console.error("Create Config Error:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
