// backend/routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const Order = require("../models/orderModel");

/**
 * GET /api/orders
 * - If ?customerId= present → only that customer's orders
 * - Admin view → all orders with basic customer fields populated
 */
router.get("/", async (req, res) => {
  try {
    const { customerId } = req.query;
    const filter = customerId ? { customerId } : {};

    const orders = await Order.find(filter)
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
 * - Single order by ID
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
 * Body: {
 *   customerId,
 *   items:[{ productId, name, qty, price, image }],
 *   total,
 *   paymentMethod,
 *   shipping:{ address, phone, email, notes }
 * }
 */
router.post("/", async (req, res) => {
  try {
    const { customerId, items, total, paymentMethod, shipping } = req.body;

    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "customerId and non-empty items are required" });
    }

    let order = new Order({
      customerId,
      items,
      total,
      paymentMethod: paymentMethod || "COD",
      shipping: shipping || {},
    });

    const MAX_TRIES = 5;
    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        order = await order.save();

        // Return with populated customer fields
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
 * Body: { status }
 */
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: "Status is required" });

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
 * - Only Admin should use this
 */
router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json({ ok: true, message: "Order deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;
