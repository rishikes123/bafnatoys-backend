const express = require("express");
const multer = require("multer");
const Banner = require("../models/bannerModel");
const imagekit = require("../config/imagekit");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

// Multer Setup (RAM Storage + 5MB limit per file)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/**
 * GET: All active banners (for frontend - public)
 */
router.get("/", async (req, res) => {
  try {
    const banners = await Banner.find({ enabled: true }).sort({ createdAt: -1 });
    res.json(banners);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET: All banners (for admin - public read is fine, admin panel handles its own auth)
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
 * POST: Upload new banners (admin only)
 */
router.post("/", adminProtect, isAdmin, upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ message: "No files uploaded" });

    const links = Array.isArray(req.body.links)
      ? req.body.links
      : req.body.links
      ? [req.body.links]
      : [];

    const uploadPromises = req.files.map((file) =>
      imagekit.upload({
        file: file.buffer,
        fileName: `banner_${Date.now()}_${file.originalname.replace(/\s+/g, "-")}`,
        folder: "/bafnatoys/banners",
      })
    );

    const imageKitResults = await Promise.all(uploadPromises);

    const bannersToSave = imageKitResults.map((result, index) => ({
      imageUrl: result.url,
      imageId: result.fileId,
      link: links[index] || "",
      enabled: true,
    }));

    const saved = await Banner.insertMany(bannersToSave);

    res.json({ success: true, message: "Banners uploaded successfully!", banners: saved });

    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH: Toggle enable/disable (admin only)
 */
router.patch("/:id/toggle", adminProtect, isAdmin, async (req, res) => {
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

    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * PATCH: Update link (admin only)
 */
router.patch("/:id/link", adminProtect, isAdmin, async (req, res) => {
  try {
    const { link } = req.body;
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    banner.link = link || "";
    await banner.save();

    res.json({ success: true, message: "Banner link updated successfully", banner });

    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * DELETE: Remove banner from ImageKit + DB (admin only)
 */
router.delete("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    if (banner.imageId) {
      await imagekit.deleteFile(banner.imageId).catch(() => {});
    }

    await banner.deleteOne();

    res.json({ success: true, message: "Banner deleted successfully" });

    const io = req.app.get("io");
    if (io) io.emit("settingsUpdated");
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
