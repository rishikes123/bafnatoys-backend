const router = require("express").Router();
const Setting = require("../models/settingModel");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

/* ================= COD SETTINGS ================= */

router.get("/cod", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "cod" });
    if (!setting) {
      setting = await Setting.create({
        key: "cod",
        data: { advanceAmount: 0, advanceType: "flat", enabled: true },
      });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/cod", adminProtect, isAdmin, async (req, res) => {
  try {
    const { advanceAmount, advanceType, enabled } = req.body;
    let isEnabled = true;
    if (enabled === false || String(enabled).toLowerCase() === "false" || enabled === 0) {
      isEnabled = false;
    }
    const setting = await Setting.findOneAndUpdate(
      { key: "cod" },
      {
        $set: {
          key: "cod",
          data: {
            advanceAmount: Number(advanceAmount) || 0,
            advanceType: advanceType === "percentage" ? "percentage" : "flat",
            enabled: isEnabled,
          },
        },
      },
      { upsert: true, new: true }
    );
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MAINTENANCE MODE ================= */

router.get("/maintenance", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "maintenance" });
    if (!setting) {
      setting = await Setting.create({ key: "maintenance", data: { enabled: false } });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/maintenance", adminProtect, isAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "maintenance" },
      { $set: { key: "maintenance", data: { enabled: Boolean(enabled) } } },
      { upsert: true, new: true }
    );
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= FORCE LOGIN WALL ================= */

router.get("/force-login", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "force-login" });
    if (!setting) {
      setting = await Setting.create({ key: "force-login", data: { enabled: false } });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/force-login", adminProtect, isAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "force-login" },
      { $set: { key: "force-login", data: { enabled: Boolean(enabled) } } },
      { upsert: true, new: true }
    );
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= PRODUCT REVIEWS SETTINGS ================= */

router.get("/reviews", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "reviews" });
    if (!setting) {
      setting = await Setting.create({ key: "reviews", data: { enabled: true } });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/reviews", adminProtect, isAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    let isEnabled = true;
    if (enabled === false || String(enabled).toLowerCase() === "false" || enabled === 0) {
      isEnabled = false;
    }
    const setting = await Setting.findOneAndUpdate(
      { key: "reviews" },
      { $set: { key: "reviews", data: { enabled: isEnabled } } },
      { upsert: true, new: true }
    );
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= ANNOUNCEMENT BANNER ================= */

router.get("/announcement", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "announcement" });
    if (!setting) {
      setting = await Setting.create({
        key: "announcement",
        data: { enabled: false, text: "", bgColor: "#e63946", textColor: "#ffffff" },
      });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/announcement", adminProtect, isAdmin, async (req, res) => {
  try {
    const { enabled, text, bgColor, textColor } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "announcement" },
      {
        $set: {
          key: "announcement",
          data: {
            enabled: Boolean(enabled),
            text: text || "",
            bgColor: bgColor || "#e63946",
            textColor: textColor || "#ffffff",
          },
        },
      },
      { upsert: true, new: true }
    );
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", { type: "announcement", data: setting.data });
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MOBILE THEME SETTINGS ================= */

router.get("/mobile-theme", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "mobile-theme" });
    if (!setting) {
      setting = await Setting.create({
        key: "mobile-theme",
        data: {
          primary: "#6366f1",
          primaryDark: "#4f46e5",
          primaryLight: "#a5b4fc",
          primaryBg: "#eef2ff",
          brandText: "#FF3366",
        },
      });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/mobile-theme", adminProtect, isAdmin, async (req, res) => {
  try {
    const { primary, primaryDark, primaryLight, primaryBg, brandText } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "mobile-theme" },
      {
        $set: {
          key: "mobile-theme",
          data: {
            primary: primary || "#6366f1",
            primaryDark: primaryDark || "#4f46e5",
            primaryLight: primaryLight || "#a5b4fc",
            primaryBg: primaryBg || "#eef2ff",
            brandText: brandText || "#FF3366",
          },
        },
      },
      { upsert: true, new: true }
    );
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", { type: "theme", data: setting.data });
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MOBILE HEADER WHATSAPP ================= */

router.get("/mobile-whatsapp", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "mobile-whatsapp" });
    if (!setting) {
      setting = await Setting.create({
        key: "mobile-whatsapp",
        data: { enabled: false, phone: "", message: "Hi! I want to place an order." },
      });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/mobile-whatsapp", adminProtect, isAdmin, async (req, res) => {
  try {
    const { enabled, phone, message } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "mobile-whatsapp" },
      {
        $set: {
          key: "mobile-whatsapp",
          data: {
            enabled: enabled !== undefined ? enabled : false,
            phone: String(phone || "").replace(/\D/g, ""),
            message: message || "Hi! I want to place an order.",
          },
        },
      },
      { upsert: true, new: true }
    );
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", { type: "whatsapp", data: setting.data });
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MOBILE LAYOUT SETTINGS ================= */

router.get("/mobile-layout", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "mobile-layout" });
    if (!setting) {
      setting = await Setting.create({ key: "mobile-layout", data: { layout: "layout1" } });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/mobile-layout", adminProtect, isAdmin, async (req, res) => {
  try {
    const { layout } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "mobile-layout" },
      { $set: { key: "mobile-layout", data: { layout: layout || "layout1" } } },
      { upsert: true, new: true }
    );
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", { type: "layout", data: { layout: layout || "layout1" } });
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= DIAGNOSTIC PING (admin only) ================= */

router.post("/ping-sync", adminProtect, isAdmin, async (req, res) => {
  const io = req.app.get("io");
  if (io) {
    io.emit("settingsUpdated", { type: "ping", timestamp: Date.now() });
    return res.json({ success: true, message: "Ping sent to all clients." });
  }
  res.status(500).json({ success: false, message: "Socket.io not initialized." });
});

/* ================= META PIXEL SETTINGS ================= */

const DEFAULT_PIXEL_EVENTS = {
  pageView: true,
  viewContent: true,
  addToCart: true,
  initiateCheckout: true,
  purchase: true,
};

router.get("/meta-pixel", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "meta-pixel" });
    if (!setting) {
      setting = await Setting.create({
        key: "meta-pixel",
        data: { pixelId: "", enabled: false, events: DEFAULT_PIXEL_EVENTS },
      });
    }
    const data = setting.data || {};
    res.json({
      pixelId: data.pixelId || "",
      enabled: Boolean(data.enabled),
      events: { ...DEFAULT_PIXEL_EVENTS, ...(data.events || {}) },
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/meta-pixel", adminProtect, isAdmin, async (req, res) => {
  try {
    const { pixelId, enabled, events } = req.body;
    const cleanPixelId = String(pixelId || "").replace(/\D/g, "").trim();
    const setting = await Setting.findOneAndUpdate(
      { key: "meta-pixel" },
      {
        $set: {
          key: "meta-pixel",
          data: {
            pixelId: cleanPixelId,
            enabled: Boolean(enabled) && cleanPixelId.length > 0,
            events: { ...DEFAULT_PIXEL_EVENTS, ...(events || {}) },
          },
        },
      },
      { upsert: true, new: true }
    );
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", { type: "meta-pixel", data: setting.data });
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= SHIPPING SETTINGS ================= */

const ShippingSettings = require("../models/ShippingSettings");

router.get("/shipping", async (req, res) => {
  try {
    let s = await ShippingSettings.findOne();
    res.json(s || {});
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/shipping", adminProtect, isAdmin, async (req, res) => {
  try {
    const updated = await ShippingSettings.findOneAndUpdate(
      {},
      { $set: req.body },
      { upsert: true, new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
