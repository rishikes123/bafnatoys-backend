const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const streamUpload = require("../utils/cloudinaryUpload");

// ✅ Cloudinary upload route
router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    // Promise.all => multiple uploads parallel
    const urls = await Promise.all(
      req.files.map((file) => streamUpload(file.buffer, "bafnatoys"))
    );

    const secureUrls = urls.map((u) => u.secure_url);

    console.log("✅ Uploaded to Cloudinary:", secureUrls);

    return res.status(200).json({ urls: secureUrls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    return res.status(500).json({ message: "Image upload failed" });
  }
});

module.exports = router;
