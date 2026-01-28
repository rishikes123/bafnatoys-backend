const express = require("express");
const router = express.Router();
const Order = require("../models/orderModel");
const Setting = require("../models/settingModel");
const Product = require("../models/Product"); // ✅ IMPORT PRODUCT MODEL (Very Important)

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
 * @route   PUT /api/orders/:id/status
 * @route   PATCH /api/orders/:id/status
 * @desc    Update order status (Admin) & Reduce Stock on Delivery
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    // Normalize status (Title Case) e.g., "delivered" -> "Delivered"
    if (!status) return res.status(400).json({ message: "Status is required" });
    
    // Convert to lowercase for comparison, but store as needed (usually lowercase or Title Case in your DB)
    // Assuming your DB enum is ["pending", "processing", "shipped", "delivered", "cancelled"] (lowercase) based on your model
    const newStatus = status.toLowerCase(); 

    const allowedStatuses = [
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ];

    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ✅ STOCK REDUCTION LOGIC
    // Agar Naya Status "delivered" hai aur Purana "delivered" nahi tha
    if (newStatus === "delivered" && order.status !== "delivered") {
        if (order.items && Array.isArray(order.items)) {
            for (const item of order.items) {
                // Item schema ke hisaab se ID 'productId' field mein hai
                const productId = item.productId?._id || item.productId;
                const qty = Number(item.qty) || 0;

                if (productId && qty > 0) {
                    // 🔻 Stock Minus karo
                    await Product.findByIdAndUpdate(productId, { 
                        $inc: { stock: -qty } 
                    });
                }
            }
        }
        order.isDelivered = true;
        order.deliveredAt = Date.now();
    }

    // Agar Cancelled ho raha hai, to Stock wapas add kar sakte hain (Optional logic)
    // if (newStatus === "cancelled" && order.status !== "cancelled") { ... increment stock ... }

    // Update Status
    order.status = newStatus;
    const updatedOrder = await order.save();

    // Populate for response
    const populatedOrder = await Order.findById(updatedOrder._id)
      .populate("customerId", "firmName shopName otpMobile city state zip visitingCardUrl")
      .lean();

    res.json(populatedOrder);
  } catch (err) {
    console.error("Status Update Error:", err);
    res.status(500).json({
      message: err.message || "Server error while updating status",
    });
  }
};

// Apply same handler for both PUT and PATCH
router.put("/:id/status", updateOrderStatus);
router.patch("/:id/status", updateOrderStatus);

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