const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
  createOrder,
  verifyPayment,
  listTransactions,
  transactionDetail,
  paymentStats,
  listSettlements,
  refundPayment,
  financeReport,
  debugDelhiveryRate,
  uploadDelhiveryCSV,
} = require("../controllers/paymentController");
const { adminProtect } = require("../middleware/authMiddleware");

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ------------------------ CUSTOMER CHECKOUT ------------------------ */
// Payment Order Create: POST /api/payments/create-order
router.post("/create-order", createOrder);

// Payment Verify: POST /api/payments/verify
router.post("/verify", verifyPayment);

/* ------------------------ ADMIN — RAZORPAY ------------------------ */
// All transactions (paginated, filterable) — pulls live from Razorpay API
router.get("/admin/transactions", adminProtect, listTransactions);

// Single transaction full detail + refunds
router.get("/admin/transaction/:id", adminProtect, transactionDetail);

// Dashboard stats (revenue, fees, method split, success rate)
router.get("/admin/stats", adminProtect, paymentStats);

// Settlements (bank credit history)
router.get("/admin/settlements", adminProtect, listSettlements);

// Manual refund — partial or full
router.post("/admin/refund/:paymentId", adminProtect, refundPayment);

// Finance Report — Razorpay + Delhivery combined per-order view
router.get("/admin/finance-report", adminProtect, financeReport);

// Debug: test raw Delhivery rate API response
router.get("/admin/debug-delhivery-rate", adminProtect, debugDelhiveryRate);

// Upload Delhivery settlement CSV to get actual freight charges
router.post("/admin/upload-delhivery-csv", adminProtect, csvUpload.single("csv"), uploadDelhiveryCSV);

module.exports = router;
