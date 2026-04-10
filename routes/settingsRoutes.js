const router = require("express").Router();
const Setting = require("../models/settingModel");

/* ================= COD SETTINGS ================= */

// GET COD Settings
router.get("/cod", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "cod" });

    if (!setting) {
      setting = await Setting.create({
        key: "cod",
        // ✅ Default me COD chalu, advanceAmount 0 aur advanceType 'flat' rahega
        data: { advanceAmount: 0, advanceType: "flat", enabled: true },
      });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE COD Settings
router.put("/cod", async (req, res) => {
  try {
    // ✅ advanceType ko request body se receive kar rahe hain
    const { advanceAmount, advanceType, enabled } = req.body;
    
    // Strict True/False checking
    let isEnabled = true;
    if (enabled === false || String(enabled).toLowerCase() === "false" || enabled === 0) {
      isEnabled = false;
    }

    const setting = await Setting.findOneAndUpdate(
      { key: "cod" },
      {
        $set: {
          key: "cod", // Ensure key exists
          data: {
            advanceAmount: Number(advanceAmount) || 0,
            // ✅ Yahan theek se check karke percentage ya flat save hoga
            advanceType: advanceType === "percentage" ? "percentage" : "flat", 
            enabled: isEnabled, 
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MAINTENANCE MODE ================= */

// GET Maintenance Status
router.get("/maintenance", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "maintenance" });

    if (!setting) {
      // Default: Maintenance OFF (Website Live)
      setting = await Setting.create({
        key: "maintenance",
        data: { enabled: false },
      });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Maintenance Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE Maintenance Status
router.put("/maintenance", async (req, res) => {
  try {
    const { enabled } = req.body; // Expecting { enabled: true/false }

    const setting = await Setting.findOneAndUpdate(
      { key: "maintenance" },
      {
        $set: {
          key: "maintenance",
          data: { enabled: Boolean(enabled) },
        },
      },
      { upsert: true, new: true }
    );

    console.log("✅ Maintenance Mode Updated:", setting.data);
    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Maintenance Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= PRODUCT REVIEWS SETTINGS (ON/OFF) ================= */

// GET Review Settings
router.get("/reviews", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "reviews" });

    if (!setting) {
      // Default: Reviews chalu (enabled: true) rahenge
      setting = await Setting.create({
        key: "reviews",
        data: { enabled: true },
      });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Reviews Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE Review Settings
router.put("/reviews", async (req, res) => {
  try {
    const { enabled } = req.body;
    
    // Strict True/False checking
    let isEnabled = true;
    if (enabled === false || String(enabled).toLowerCase() === "false" || enabled === 0) {
      isEnabled = false;
    }

    const setting = await Setting.findOneAndUpdate(
      { key: "reviews" },
      {
        $set: {
          key: "reviews",
          data: { enabled: isEnabled },
        },
      },
      { upsert: true, new: true }
    );

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Reviews Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= ANNOUNCEMENT BANNER ================= */

// GET Announcement
router.get('/announcement', async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: 'announcement' });
    if (!setting) {
      setting = await Setting.create({
        key: 'announcement',
        data: { enabled: false, text: '', bgColor: '#e63946', textColor: '#ffffff' },
      });
    }
    res.json(setting.data);
  } catch (err) {
    console.error('❌ GET Announcement Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// UPDATE Announcement
router.put('/announcement', async (req, res) => {
  try {
    const { enabled, text, bgColor, textColor } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: 'announcement' },
      { $set: { key: 'announcement', data: { enabled: Boolean(enabled), text: text || '', bgColor: bgColor || '#e63946', textColor: textColor || '#ffffff' } } },
      { upsert: true, new: true }
    );

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) {
      console.log("📢 [BACKEND] Broadcasting 'settingsUpdated' for ANNOUNCEMENT change...");
      io.emit("settingsUpdated", { type: "announcement", data: setting.data });
    }

    res.json(setting.data);
  } catch (err) {
    console.error('❌ PUT Announcement Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

/* ================= MOBILE THEME SETTINGS ================= */

// GET Mobile Theme
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
    console.error("❌ GET Mobile Theme Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE Mobile Theme
router.put("/mobile-theme", async (req, res) => {
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

    // 🚀 Signal mobile app to refresh with NEW DATA directly
    const io = req.app.get("io");
    if (io) {
      console.log("📢 [BACKEND] Broadcasting 'settingsUpdated' for THEME change...");
      io.emit("settingsUpdated", { type: "theme", data: setting.data });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Mobile Theme Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MOBILE HEADER WHATSAPP ================= */

// GET Mobile WhatsApp Header Settings
router.get("/mobile-whatsapp", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "mobile-whatsapp" });
    if (!setting) {
      setting = await Setting.create({
        key: "mobile-whatsapp",
        data: {
          enabled: false,
          phone: "",
          message: "Hi! I want to place an order.",
        },
      });
    }
    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Mobile WhatsApp Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// PUT Mobile WhatsApp Header Settings
router.put("/mobile-whatsapp", async (req, res) => {
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

    // 🚀 Signal mobile app to refresh with NEW DATA directly
    const io = req.app.get("io");
    if (io) {
      console.log("📢 [BACKEND] Broadcasting 'settingsUpdated' for WHATSAPP change...");
      io.emit("settingsUpdated", { type: "whatsapp", data: setting.data });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Mobile WhatsApp Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MOBILE LAYOUT SETTINGS ================= */

// GET Mobile Home Layout
router.get("/mobile-layout", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "mobile-layout" });
    if (!setting) {
      setting = await Setting.create({
        key: "mobile-layout",
        data: { layout: "layout1" },
      });
    }
    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Mobile Layout Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE Mobile Home Layout
router.put("/mobile-layout", async (req, res) => {
  try {
    const { layout } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "mobile-layout" },
      {
        $set: {
          key: "mobile-layout",
          data: { layout: layout || "layout1" },
        },
      },
      { upsert: true, new: true }
    );

    // 🚀 Signal mobile app to refresh with NEW DATA directly
    const io = req.app.get("io");
    if (io) {
      console.log(`📢 [BACKEND] Broadcasting 'settingsUpdated' for LAYOUT change: ${layout}`);
      io.emit("settingsUpdated", { type: "layout", data: { layout: layout || "layout1" } });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Mobile Layout Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// ✅ DIAGNOSTIC: Trigger a ping to all mobile apps
router.post("/ping-sync", async (req, res) => {
  const io = req.app.get("io");
  if (io) {
    console.log("📡 [DIAGNOSTIC] Admin triggered a Sync Ping...");
    io.emit("settingsUpdated", { type: "ping", timestamp: Date.now() });
    return res.json({ success: true, message: "Ping sent to all clients." });
  }
  res.status(500).json({ success: false, message: "Socket.io not initialized." });
});

const ShippingSettings = require("../models/ShippingSettings");

/* ================= SHIPPING SETTINGS ================= */

// GET Shipping Settings
router.get("/shipping", async (req, res) => {
  try {
    let settings = await ShippingSettings.findOne();
    if (!settings) {
      settings = await ShippingSettings.create({
        shippingCharge: 250,
        freeShippingThreshold: 5000,
      });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE Shipping Settings
router.put("/shipping", async (req, res) => {
  try {
    const { shippingCharge, freeShippingThreshold } = req.body;
    const settings = await ShippingSettings.findOneAndUpdate(
      {},
      {
        shippingCharge: Number(shippingCharge) || 0,
        freeShippingThreshold: Number(freeShippingThreshold) || 0,
      },
      { new: true, upsert: true }
    );
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;