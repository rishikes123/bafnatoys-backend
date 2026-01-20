const express = require("express");
const router = express.Router();
// axios removed as it is no longer needed for shipping API
const Order = require("../models/orderModel");
const Setting = require("../models/settingModel");

/**
 * @route   GET /api/orders
 * @desc    Get all orders (optionally filter by customerId)
 */
router.get("/", async (req, res) => {
  try {
    const { customerId } = req.query;
    const filter = customerId ? { customerId } : {};

    const orders = await Order.find(filter)
      .populate(
        "customerId",
        "firmName shopName otpMobile city state zip visitingCardUrl address"
      )
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while fetching orders",
    });
  }
});

/**
 * @route   GET /api/orders/:id
 * @desc    Get a single order by ID
 */
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate(
        "customerId",
        "firmName shopName otpMobile city state zip visitingCardUrl address"
      )
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while fetching order details",
    });
  }
});

/**
 * @route   POST /api/orders
 * @desc    Create a new order (Supports Shipping + COD Advance)
 */
router.post("/", async (req, res) => {
  try {
    const {
      customerId,
      items,
      total,              // Grand Total
      paymentMode,        // Frontend usually sends this
      paymentMethod,      // Fallback
      shippingAddress,
      
      // ✅ COD fields
      codAdvancePaid, 
      codRemainingAmount,

      // ✅ Price Breakdown
      itemsPrice,
      shippingPrice
    } = req.body;

    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "CustomerId and non-empty items are required",
      });
    }

    // Determine Payment Mode
    const finalPaymentMethod = paymentMode || paymentMethod || "COD";

    /* ================= CREATE ORDER ================= */
    let order = new Order({
      customerId,
      items,
      shippingAddress: shippingAddress || {},

      // ✅ CORRECT MAPPING
      itemsPrice: itemsPrice || 0,
      shippingPrice: shippingPrice || 0, 
      total: total,

      paymentMode: finalPaymentMethod,

      advancePaid: codAdvancePaid || 0,
      remainingAmount: codRemainingAmount || 0,
    });

    const MAX_TRIES = 5;
    let savedOrder = null;

    // Order number collision retry
    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        savedOrder = await order.save();
        break;
      } catch (e) {
        if (e?.code === 11000 && String(e.message).includes("orderNumber")) {
          order.orderNumber = "ODR" + Math.floor(100000 + Math.random() * 900000);
          continue;
        }
        throw e;
      }
    }

    if (!savedOrder) {
      return res.status(500).json({
        message: "Could not create order after several attempts",
      });
    }

    const populatedOrder = await Order.findById(savedOrder._id)
      .populate(
        "customerId",
        "firmName shopName otpMobile city state zip visitingCardUrl"
      )
      .lean();

    res.status(201).json({ order: populatedOrder });
  } catch (err) {
    console.error("Order Creation Error:", err);
    res.status(500).json({
      message: err.message || "Server error while creating order",
    });
  }
});

/**
 * @route   PATCH /api/orders/:id/status
 * @desc    Update order status (Admin)
 */
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = [
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid or missing status" });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    )
      .populate(
        "customerId",
        "firmName shopName otpMobile city state zip visitingCardUrl"
      )
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while updating status",
    });
  }
});

/**
 * @route   DELETE /api/orders/:id
 * @desc    Delete an order
 */
router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json({ ok: true, message: "Order deleted successfully" });
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while deleting order",
    });
  }
});

module.exports = router;