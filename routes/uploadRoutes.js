const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

// Upload route
router.post("/", upload.array("images", 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    // ✅ Cloudinary gives secure_url in file.path
    const urls = req.files.map(file => file.path);

    console.log("✅ Uploaded to Cloudinary:", urls);
    return res.status(200).json({ urls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    return res.status(500).json({ message: "Image upload failed" });
  }
});

module.exports = router;
