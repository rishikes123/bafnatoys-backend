const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

router.post("/", upload.array("images", 10), (req, res) => {
  try {
    console.log("📤 Upload request received");

    if (!req.files || req.files.length === 0) {
      console.error("❌ No files received");
      return res.status(400).json({ error: "No files uploaded" });
    }

    console.log("✅ Files uploaded to Cloudinary:", req.files);

    const urls = req.files.map(file => file.path); // Cloudinary gives .path = secure_url
    return res.json({ urls });
  } catch (err) {
    console.error("❌ Upload route error:", err);
    return res.status(500).json({ error: err.message || "Upload failed" });
  }
});

module.exports = router;
