const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    console.log("📸 Upload Request received");
    console.log("Files received:", req.files);

    const urls = req.files.map(file => file.path); // Cloudinary gives file.path as URL
    res.json({ urls });
  } catch (error) {
    console.error("❌ Upload Error:", error);
    res.status(500).json({
      message: "Upload failed",
      error: error.message || error,
      stack: error.stack || null,
    });
  }
});

module.exports = router;
