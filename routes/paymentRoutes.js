const express = require("express");
const router = express.Router();
const {
  createOrder,
  verifyPayment,
  listTransactions,
  transactionDetail,
  paymentStats,
  listSettlements,
  refundPayment,
} = require("../controllers/paymentController");
const { adminProtect } = require("../middleware/authMiddleware");

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

module.exports = router;
