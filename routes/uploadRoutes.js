const express = require("express");
const router = express.Router();
const multer = require("multer");
const imagekit = require("../config/imagekit"); // Make sure yeh path sahi ho

// ImageKit ke liye humein files memory mein store karni hoti hain
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/upload
router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    console.log("📸 Upload Request received (ImageKit)");
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No images provided" });
    }

    console.log(`Files received: ${req.files.length}`);

    // Saari images ko ek saath ImageKit par upload karne ke liye Promise.all ka use
    const uploadPromises = req.files.map((file) => {
      return imagekit.upload({
        file: file.buffer,             // Multer se mili hui file ka data
        fileName: file.originalname,   // Original naam
        folder: "/bafnatoys_images",   // ImageKit mein kis folder mein save karna hai
      });
    });

    const results = await Promise.all(uploadPromises);

    // ImageKit successful upload ke baad "url" return karta hai
    const urls = results.map(result => result.url);

    res.json({ urls });
    
  } catch (error) {
    console.error("❌ Upload Error:", error);
    res.status(500).json({
      message: "ImageKit Upload failed",
      error: error.message || error,
    });
  }
});

module.exports = router;