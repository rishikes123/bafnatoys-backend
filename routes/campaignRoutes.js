// backend/routes/campaignRoutes.js
const express = require("express");
const multer = require("multer");
const router = express.Router();
const ctrl = require("../controllers/campaignController");
const imagekit = require("../config/imagekit");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// Multer for campaign media (image / video / document) — 20 MB cap
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// POST /api/campaigns/upload-media  — uploads a single file to ImageKit
// Returns { success, url, fileId } for use in Header field of a campaign.
router.post(
  "/upload-media",
  adminProtect,
  isAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }
      const safeName = req.file.originalname.replace(/\s+/g, "-");
      const result = await imagekit.upload({
        file: req.file.buffer,
        fileName: `campaign_${Date.now()}_${safeName}`,
        folder: "/bafnatoys/campaigns",
      });
      return res.json({
        success: true,
        url: result.url,
        fileId: result.fileId,
        name: result.name,
        size: result.size,
      });
    } catch (err) {
      console.error("campaign upload error:", err);
      return res
        .status(500)
        .json({ success: false, message: err.message || "Upload failed" });
    }
  }
);

// Preview audience count
router.get("/preview", adminProtect, isAdmin, ctrl.previewAudience);

// Product helper (for building variables with link)
router.get("/product-link/:id", adminProtect, isAdmin, ctrl.getProductLink);

// Create + start campaign
router.post("/", adminProtect, isAdmin, ctrl.createCampaign);

// History list
router.get("/", adminProtect, isAdmin, ctrl.listCampaigns);

// Detail with per-recipient logs
router.get("/:id", adminProtect, isAdmin, ctrl.getCampaign);

// Cancel running campaign
router.post("/:id/cancel", adminProtect, isAdmin, ctrl.cancelCampaign);

module.exports = router;
