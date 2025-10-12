const express = require("express");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const Banner = require("../models/bannerModel");
const router = express.Router();

// 🌩️ Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 🧩 Cloudinary Storage (auto optimize)
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "bafnatoys/banners",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  },
});

const upload = multer({ storage });

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

    const saved = await Banner.insertMany(
      req.files.map((file, index) => ({
        imageUrl: file.path, // ✅ Cloudinary gives full secure URL
        link: links[index] || "",
        enabled: true,
      }))
    );

    res.json({
      success: true,
      message: "✅ Banners uploaded successfully!",
      banners: saved,
    });
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
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 🗑 DELETE: Remove banner from Cloudinary + DB
 */
router.delete("/:id", async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    // 🧩 Extract public_id from Cloudinary URL
    const match = banner.imageUrl.match(/upload\/(.+)\.[a-zA-Z]+$/);
    if (match && match[1]) {
      const publicId = match[1];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.warn("⚠️ Cloudinary delete failed:", err.message);
      }
    }

    await banner.deleteOne();
    res.json({ success: true, message: "🗑️ Banner deleted successfully" });
  } catch (err) {
    console.error("❌ Delete failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
