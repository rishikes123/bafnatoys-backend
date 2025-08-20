// backend/routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const Order = require("../models/orderModel");

/**
 * GET /api/orders
 * - customerId query aayega to sirf us customer ke orders
 * - admin list ke liye Registration (customer) ke basic fields populate
 */
router.get("/", async (req, res) => {
  try {
    const { customerId } = req.query;
    const q = customerId ? { customerId } : {};

    const orders = await Order.find(q)
      .populate("customerId", "firmName shopName otpMobile city state zip visitingCardUrl")
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * GET /api/orders/:id
 * - single order with populated customer
 */
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "firmName shopName otpMobile city state zip visitingCardUrl")
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * POST /api/orders
 * Body: { customerId, items:[{productId,name,qty,price,image}], total, paymentMethod, shipping:{address, phone, email, notes} }
 * - orderNumber model me pre('validate') se aayega
 * - rare duplicate par retry
 */
router.post("/", async (req, res) => {
  try {
    const { customerId, items, total, paymentMethod, shipping } = req.body;

    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "customerId and non-empty items are required" });
    }

    let order = new Order({
      customerId,
      items,
      total,
      paymentMethod: paymentMethod || "COD",
      shipping: shipping || {}, // ⬅️ store address/phone/email/notes
    });

    const MAX_TRIES = 5;
    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        order = await order.save();
        // return with populated customer for immediate UI
        const saved = await Order.findById(order._id)
          .populate("customerId", "firmName shopName otpMobile city state zip visitingCardUrl")
          .lean();

        return res.status(201).json({ order: saved });
      } catch (e) {
        // Handle rare orderNumber unique collision
        if (e?.code === 11000 && String(e.message).includes("orderNumber")) {
          order.orderNumber = "ODR" + Math.floor(100000 + Math.random() * 900000);
          continue;
        }
        throw e;
      }
    }
    res.status(500).json({ message: "Could not create order (retries exhausted)" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * PATCH /api/orders/:id/status
 */
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    )
      .populate("customerId", "firmName shopName otpMobile city state zip visitingCardUrl")
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * DELETE /api/orders/:id
 * - used by Admin panel
 */
router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;
