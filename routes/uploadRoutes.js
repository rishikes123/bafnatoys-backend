// routes/uploadRoutes.js
const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");

router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    console.log("📥 Received files:", req.files.map(f => f.originalname));

    const uploadResults = [];
    for (const file of req.files) {
      console.log("🚀 Uploading to Cloudinary:", file.originalname);

      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "bafnatoys" },
          (error, result) => {
            if (error) {
              console.error("❌ Cloudinary upload failed:", error);
              return reject(error);
            }
            resolve(result);
          }
        );
        stream.end(file.buffer);
      });

      uploadResults.push(result.secure_url);
    }

    console.log("✅ Uploaded URLs:", uploadResults);

    return res.status(200).json({ urls: uploadResults });
  } catch (err) {
    console.error("🔥 Upload route error:", err);
    return res.status(500).json({ message: "Image upload failed", error: err.message || err });
  }
});

module.exports = router;
