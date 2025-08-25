const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

// POST /api/upload
router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    console.log("📸 Upload Request received");
    console.log("Files received:", req.files);

    // Cloudinary returns secure_url in file.path
    const urls = req.files.map(file => file.path);

    res.json({ urls });
  } catch (error) {
    console.error("❌ Upload Error:", error);
    res.status(500).json({
      message: "Upload failed",
      error: error.message || error,
    });
  }
});

module.exports = router;
