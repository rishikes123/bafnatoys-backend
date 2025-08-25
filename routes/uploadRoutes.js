const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const streamUpload = require("../utils/cloudinaryUpload");

// ✅ Upload route with extra logging
router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    // 🔎 Debug logs for Railway
    console.log("📂 Incoming files:", req.files.length);
    console.log("🔑 Cloudinary ENV Check:", {
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "MISSING",
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? "SET" : "MISSING",
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? "SET" : "MISSING",
    });

    const urls = [];
    for (const file of req.files) {
      const result = await streamUpload(file.buffer, "bafnatoys"); // ✅ use folder 'bafnatoys'
      urls.push(result.secure_url);
    }

    console.log("✅ Uploaded to Cloudinary:", urls);

    return res.status(200).json({ urls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    return res.status(500).json({
      message: "Image upload failed",
      error: err.message || "Unknown error"
    });
  }
});

module.exports = router;
