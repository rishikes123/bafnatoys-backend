const express = require("express");
const router = express.Router();
const { createShippingOrder, createSplitShipment } = require("../controllers/shippingController");
const dh = require("../controllers/delhiveryAdminController");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

/* ----------------------- EXISTING ----------------------- */
// Create shipping order (admin only)
router.post("/create", adminProtect, isAdmin, createShippingOrder);

// Create split shipment — 2nd/3rd box for same order
router.post("/create-split", adminProtect, isAdmin, createSplitShipment);

/* =============== DELHIVERY ADMIN PANEL =============== */

// Dashboard stats
router.get("/delhivery/stats", adminProtect, dh.stats);

// Wallet balance (may not be supported on all accounts)
router.get("/delhivery/wallet", adminProtect, dh.wallet);

// Shipments list with live tracking merged
router.get("/delhivery/shipments", adminProtect, dh.listShipments);

// Track single AWB (full scan history)
router.get("/delhivery/track/:awb", adminProtect, dh.trackOne);

// Pincode serviceability
router.get("/delhivery/pincode/:pin", adminProtect, dh.pincode);

// Rate calculator (express vs surface)
router.post("/delhivery/rate", adminProtect, dh.rate);

// Pickup request
router.post("/delhivery/pickup", adminProtect, dh.createPickup);

// NDR dashboard
router.get("/delhivery/ndr", adminProtect, dh.ndrList);

// NDR action (re-attempt / RTO / defer)
router.post("/delhivery/ndr-action/:awb", adminProtect, dh.ndrAction);

// Wallet transactions + per-shipment ledger
router.get("/delhivery/transactions", adminProtect, dh.transactions);

module.exports = router;
