const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

router.post("/", upload.array("images", 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const urls = req.files.map((file) => file.path); // Cloudinary URL
    return res.status(200).json({ urls });
  } catch (err) {
    console.error("❌ Upload error:", err);
    return res.status(500).json({ message: "Image upload failed", error: err.message });
  }
});

module.exports = router;
