const router = require("express").Router();
const bcrypt = require("bcryptjs");
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
        data: { pixelId: "", accessToken: "", enabled: false, events: DEFAULT_PIXEL_EVENTS },
      });
    }
    const data = setting.data || {};
    // Ye route public hai (website ka pixel loader isse padhta hai), isliye
    // accessToken kabhi bahar nahi bhejte — sirf batate hain ki set hai ya nahi.
    res.json({
      pixelId: data.pixelId || "",
      hasToken: Boolean(data.accessToken),
      enabled: Boolean(data.enabled),
      events: { ...DEFAULT_PIXEL_EVENTS, ...(data.events || {}) },
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/meta-pixel", adminProtect, isAdmin, async (req, res) => {
  try {
    const { pixelId, accessToken, enabled, events } = req.body;
    const cleanPixelId = String(pixelId || "").replace(/\D/g, "").trim();
    // Admin panel ab token wapas nahi padh sakta, isliye khaali bheje to purana rakho
    const existing = await Setting.findOne({ key: "meta-pixel" });
    const newToken = (accessToken || "").trim();
    const finalToken = newToken || existing?.data?.accessToken || "";
    const setting = await Setting.findOneAndUpdate(
      { key: "meta-pixel" },
      {
        $set: {
          key: "meta-pixel",
          data: {
            pixelId: cleanPixelId,
            accessToken: finalToken,
            enabled: Boolean(enabled) && cleanPixelId.length > 0,
            events: { ...DEFAULT_PIXEL_EVENTS, ...(events || {}) },
          },
        },
      },
      { upsert: true, new: true }
    );
    // Socket sab clients tak jata hai aur response admin panel ko — dono me token nahi bhejte
    const safeData = {
      pixelId: setting.data.pixelId,
      hasToken: Boolean(setting.data.accessToken),
      enabled: setting.data.enabled,
      events: setting.data.events,
    };
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated", { type: "meta-pixel", data: safeData });
    res.json(safeData);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= SHIPPING SETTINGS ================= */

const ShippingSettings = require("../models/ShippingSettings");
const {
  normalizeShippingSettings,
  validateShippingSettings,
} = require("../services/shippingPricingService");

router.get("/shipping", async (req, res) => {
  try {
    const settings = await ShippingSettings.findOne().lean();
    res.json({
      ...(settings || {}),
      ...normalizeShippingSettings(settings || {}),
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/shipping", adminProtect, isAdmin, async (req, res) => {
  try {
    const shippingSettings = validateShippingSettings(req.body);
    const updated = await ShippingSettings.findOneAndUpdate(
      {},
      { $set: shippingSettings },
      { upsert: true, new: true }
    ).lean();
    res.json({ ...updated, ...normalizeShippingSettings(updated) });
  } catch (err) {
    res.status(400).json({ message: err.message || "Invalid shipping settings" });
  }
});

/* ================= NIMBUSPOST SETTINGS ================= */

router.get("/nimbuspost", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "nimbuspost" });
    if (!setting) {
      setting = await Setting.create({
        key: "nimbuspost",
        data: {
          enabled: false,
          email: "",
          password: "",
          pickupWarehouseName: "Primary",
          pickupContactName: "",
          pickupAddress: "",
          pickupCity: "",
          pickupState: "",
          pickupPincode: "",
          pickupPhone: "",
          token: "",
          tokenExpiry: null,
        },
      });
    }
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/nimbuspost", adminProtect, isAdmin, async (req, res) => {
  try {
    const {
      enabled,
      email,
      password,
      pickupWarehouseName,
      pickupContactName,
      pickupAddress,
      pickupCity,
      pickupState,
      pickupPincode,
      pickupPhone,
    } = req.body;

    let isEnabled = Boolean(enabled);

    let setting = await Setting.findOne({ key: "nimbuspost" });
    let existingData = setting ? setting.data : {};

    const updatedData = {
      enabled: isEnabled,
      email: email || "",
      password: password || "",
      pickupWarehouseName: pickupWarehouseName || "Primary",
      pickupContactName: pickupContactName || "",
      pickupAddress: pickupAddress || "",
      pickupCity: pickupCity || "",
      pickupState: pickupState || "",
      pickupPincode: pickupPincode || "",
      pickupPhone: pickupPhone || "",
      token: password === existingData.password ? (existingData.token || "") : "",
      tokenExpiry: password === existingData.password ? (existingData.tokenExpiry || null) : null,
    };

    setting = await Setting.findOneAndUpdate(
      { key: "nimbuspost" },
      { $set: { key: "nimbuspost", data: updatedData } },
      { upsert: true, new: true }
    );
    res.json(setting.data);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= ORDER EDIT SECURITY PASSWORD ================= */

router.get("/order-edit-password", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "order-edit-password" });
    if (!setting) {
      setting = await Setting.create({
        key: "order-edit-password",
        data: { enabled: false, password: "" },
      });
    }
    res.json({
      enabled: Boolean(setting.data?.enabled),
      password: setting.data?.password || "",
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/order-edit-password", adminProtect, isAdmin, async (req, res) => {
  try {
    const { enabled, password } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: "order-edit-password" },
      {
        $set: {
          key: "order-edit-password",
          data: {
            enabled: Boolean(enabled),
            password: password ? String(password).trim() : "",
          },
        },
      },
      { upsert: true, new: true }
    );
    res.json({
      ok: true,
      message: "Order edit security password updated successfully",
      data: setting.data,
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.post("/verify-order-edit-password", async (req, res) => {
  try {
    const { password } = req.body;
    const setting = await Setting.findOne({ key: "order-edit-password" });
    if (!setting || !setting.data || !setting.data.enabled || !setting.data.password) {
      return res.json({ ok: true, unlocked: true, message: "Protection is disabled or not set." });
    }
    if (setting.data.password === String(password || "").trim()) {
      return res.json({ ok: true, unlocked: true, message: "Password verified!" });
    }
    return res.status(400).json({ ok: false, unlocked: false, message: "Incorrect password! Please enter the correct password." });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= ORDER CANCELLATION SECURITY PASSWORD ================= */

router.get("/order-cancellation-password", adminProtect, isAdmin, async (req, res) => {
  try {
    const setting = await Setting.findOne({ key: "order-cancellation-password" }).lean();
    res.json({
      enabled: Boolean(setting?.data?.enabled),
      hasPassword: Boolean(setting?.data?.passwordHash),
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/order-cancellation-password", adminProtect, isAdmin, async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const password = String(req.body?.password || "").trim();
    const existing = await Setting.findOne({ key: "order-cancellation-password" });
    let passwordHash = existing?.data?.passwordHash || "";

    if (password) {
      if (password.length < 4) {
        return res.status(400).json({ message: "Cancellation password must be at least 4 characters." });
      }
      passwordHash = await bcrypt.hash(password, 12);
    }

    if (enabled && !passwordHash) {
      return res.status(400).json({ message: "Set a cancellation password before enabling protection." });
    }

    await Setting.findOneAndUpdate(
      { key: "order-cancellation-password" },
      { $set: { key: "order-cancellation-password", data: { enabled, passwordHash } } },
      { upsert: true, new: true }
    );

    res.json({
      ok: true,
      enabled,
      hasPassword: Boolean(passwordHash),
      message: enabled
        ? "Order cancellation password protection enabled."
        : "Order cancellation password protection disabled.",
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
