// backend/routes/campaignRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/campaignController");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

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
