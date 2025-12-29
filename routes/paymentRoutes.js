const express = require("express");
const router = express.Router();
const { createOrder, verifyPayment } = require("../controllers/paymentController");

// Payment Order Create: POST /api/payments/create-order
router.post("/create-order", createOrder);

// Payment Verify: POST /api/payments/verify
router.post("/verify", verifyPayment);

module.exports = router;