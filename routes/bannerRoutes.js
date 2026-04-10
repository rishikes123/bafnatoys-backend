const express = require("express");
const multer = require("multer");
const Banner = require("../models/bannerModel");
const imagekit = require("../config/imagekit"); 
const router = express.Router();

// 2️⃣ Multer Setup (RAM Storage + 5MB limit per file)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } 
});

/**
 * 🆕 POST: Upload new banners with optional links
 * Supports multiple images + link[] array from frontend
 */
router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ message: "No files uploaded" });

    // ✅ Handle multiple links aligned with file indexes
    const links = Array.isArray(req.body.links)
      ? req.body.links
      : req.body.links
      ? [req.body.links]
      : [];

    // ⚡ Upload saari images parallel me ImageKit pe (Performance Boost)
    const uploadPromises = req.files.map((file) => {
      return imagekit.upload({
        file: file.buffer,
        fileName: `banner_${Date.now()}_${file.originalname.replace(/\s+/g, '-')}`,
        folder: "/bafnatoys/banners",
      });
    });

    const imageKitResults = await Promise.all(uploadPromises);

    // ✅ Database me save karo
    const bannersToSave = imageKitResults.map((result, index) => ({
      imageUrl: result.url,       // ImageKit URL
      imageId: result.fileId,     // ImageKit ID (for deletion)
      link: links[index] || "",
      enabled: true,
    }));

    const saved = await Banner.insertMany(bannersToSave);

    res.json({
      success: true,
      message: "✅ Banners uploaded successfully!",
      banners: saved,
    });

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * 🧠 GET: All active banners (for frontend)
 */
router.get("/", async (req, res) => {
  try {
    const banners = await Banner.find({ enabled: true }).sort({
      createdAt: -1,
    });
    res.json(banners);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 🧩 GET: All banners (for admin)
 */
router.get("/all", async (req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt: -1 });
    res.json(banners);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 🔄 PATCH: Toggle enable/disable
 */
router.patch("/:id/toggle", async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    banner.enabled = !banner.enabled;
    await banner.save();

    res.json({
      success: true,
      message: `Banner ${banner.enabled ? "enabled" : "disabled"} successfully`,
      banner,
    });

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * ✏️ PATCH: Update link (optional feature)
 */
router.patch("/:id/link", async (req, res) => {
  try {
    const { link } = req.body;
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    banner.link = link || "";
    await banner.save();

    res.json({
      success: true,
      message: "🔗 Banner link updated successfully",
      banner,
    });

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 🗑 DELETE: Remove banner from ImageKit + DB
 */
router.delete("/:id", async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    // 🧩 ImageKit se file delete karo using imageId
    if (banner.imageId) {
      await imagekit.deleteFile(banner.imageId).catch((err) => {
        console.warn("⚠️ ImageKit delete failed:", err.message);
      });
    }

    await banner.deleteOne();

    res.json({ success: true, message: "🗑️ Banner deleted successfully" });

    // 🚀 Signal mobile app to refresh
    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    console.error("❌ Delete failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;