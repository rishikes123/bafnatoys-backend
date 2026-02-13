const express = require("express");
const router = express.Router();
const Order = require("../models/orderModel"); // Ensure path is correct
const Setting = require("../models/settingModel"); // Ensure path is correct
const Product = require("../models/Product"); // Ensure path is correct
const sendEmail = require("../utils/sendEmail"); // ✅ Import Email Helper

// Note: Agar aapke paas auth middleware hai (isAuth, isAdmin), toh unhe import karke routes me use karein.
// const { isAuth, isAdmin } = require("../utils/utils");

/* ============================================================
   ✅ ANALYTICS ROUTES (Must be before /:id)
============================================================ */

/**
 * @route   GET /api/orders/analytics/top-selling
 * @desc    Get top 5 selling products based on quantity
 */
router.get("/analytics/top-selling", async (req, res) => {
  try {
    const topProducts = await Order.aggregate([
      { $match: { status: { $nin: ["cancelled", "returned"] } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          name: { $first: "$items.name" },
          image: { $first: "$items.image" },
          price: { $first: "$items.price" },
          totalSold: { $sum: "$items.qty" },
          totalRevenue: { $sum: { $multiply: ["$items.qty", "$items.price"] } },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: 5 },
    ]);

    res.json(topProducts);
  } catch (err) {
    console.error("Top Selling Error:", err);
    res.status(500).json({ message: "Server error fetching top products" });
  }
});

/* ============================================================
   ✅ STANDARD ORDER ROUTES
============================================================ */

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
 * @desc    Create a new order & Notify Admin via Email
 */
router.post("/", async (req, res) => {
  try {
    const {
      customerId,
      items,
      total, // Grand Total
      paymentMode, // Frontend usually sends this
      paymentMethod, // Fallback
      shippingAddress,

      // ✅ COD fields
      codAdvancePaid,
      codRemainingAmount,

      // ✅ Price Breakdown
      itemsPrice,
      shippingPrice,
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
          order.orderNumber =
            "ODR" + Math.floor(100000 + Math.random() * 900000);
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

    // ✅ RESPONSE PEHLE BHEJO (Processing stuck fix)
    res.status(201).json({ order: populatedOrder });

    // ============================================================
    // ✅ SEND EMAIL NOTIFICATION TO ADMIN (background, no await)
    // ============================================================
    (async () => {
      try {
        const adminEmail = process.env.ADMIN_EMAIL; // .env se email lega

        if (adminEmail) {
          const emailSubject = `🚀 New Order Alert: ${populatedOrder.orderNumber}`;

          const emailMessage = `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; max-width: 600px;">
                    <h2 style="color: #27ae60;">New Order Received! 🎉</h2>
                    <p><strong>Order ID:</strong> ${populatedOrder.orderNumber}</p>
                    <p><strong>Customer:</strong> ${
                      populatedOrder.customerId?.shopName || "Guest"
                    } (${populatedOrder.customerId?.city || ""})</p>
                    <p><strong>Mobile:</strong> ${
                      populatedOrder.customerId?.otpMobile || "N/A"
                    }</p>
                    <p><strong>Total Amount:</strong> ₹${populatedOrder.total}</p>
                    <p><strong>Payment Mode:</strong> ${
                      populatedOrder.paymentMode
                    }</p>
                    
                    <hr/>
                    <h3>Items Ordered:</h3>
                    <ul style="padding-left: 20px;">
                        ${populatedOrder.items
                          .map(
                            (item) => `
                            <li style="margin-bottom: 5px;">
                                <strong>${item.name}</strong> - Qty: ${item.qty}
                            </li>
                        `
                          )
                          .join("")}
                    </ul>
                    <hr/>
                    
                    <p>Please check the admin panel for more details.</p>
                </div>
            `;

          // ✅ Send Email (non-blocking)
          await sendEmail({
            to: adminEmail,
            subject: emailSubject,
            html: emailMessage,
          });
          console.log("Admin notification email sent.");
        }
      } catch (emailError) {
        console.error("Failed to send admin email:", emailError.message);
      }
    })();
  } catch (err) {
    console.error("Order Creation Error:", err);
    res.status(500).json({
      message: err.message || "Server error while creating order",
    });
  }
});

/* ============================================================
   ✅ RETURN REQUEST ROUTES
============================================================ */

/**
 * @route   PUT /api/orders/return/:id
 * @desc    User requests a return (Images/Video URLs req body me aayenge)
 */
router.put("/return/:id", async (req, res) => {
  try {
    const { reason, description, images, video } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      if (order.status !== "delivered") {
        return res
          .status(400)
          .send({ message: "Order must be delivered to request return." });
      }

      order.returnRequest = {
        isRequested: true,
        status: "Pending",
        reason: reason,
        description: description,
        proofImages: images || [],
        proofVideo: video || "",
        requestDate: Date.now(),
      };

      const updatedOrder = await order.save();
      res.send({ message: "Return Requested Successfully", order: updatedOrder });
    } else {
      res.status(404).send({ message: "Order Not Found" });
    }
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

/**
 * @route   PUT /api/orders/admin/return-action/:id
 * @desc    Admin Approves or Rejects Return
 */
router.put("/admin/return-action/:id", async (req, res) => {
  try {
    const { status, comment } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      order.returnRequest.status = status;
      order.returnRequest.adminComment = comment;

      if (status === "Approved") {
        order.status = "returned";
      }

      await order.save();
      res.send({ message: "Return Status Updated" });
    } else {
      res.status(404).send({ message: "Order Not Found" });
    }
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

/* ============================================================
   ✅ STATUS & TRACKING UPDATE & CANCELLATION
============================================================ */

const updateOrderStatus = async (req, res) => {
  try {
    const { status, trackingId, courierName, cancelledBy } = req.body;

    if (!status) return res.status(400).json({ message: "Status is required" });

    const newStatus = status.toLowerCase();

    const allowedStatuses = [
      "pending",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
      "returned",
    ];

    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // ✅ STOCK REDUCTION LOGIC
    if (newStatus === "delivered" && order.status !== "delivered") {
      if (order.items && Array.isArray(order.items)) {
        for (const item of order.items) {
          const productId = item.productId?._id || item.productId;
          const qty = Number(item.qty) || 0;

          if (productId && qty > 0) {
            await Product.findByIdAndUpdate(productId, {
              $inc: { stock: -qty },
            });
          }
        }
      }
      order.isDelivered = true;
      order.deliveredAt = Date.now();
    }

    // ✅ UPDATE TRACKING DETAILS
    if (newStatus === "shipped") {
      if (trackingId) order.trackingId = trackingId;
      if (courierName) order.courierName = courierName;
      order.isShipped = true;
    }

    // Update Status
    order.status = newStatus;

    // ✅ SAVE WHO CANCELLED THE ORDER
    if (newStatus === "cancelled" && cancelledBy) {
      order.cancelledBy = cancelledBy;
    }

    const updatedOrder = await order.save();

    const populatedOrder = await Order.findById(updatedOrder._id)
      .populate(
        "customerId",
        "firmName shopName otpMobile city state zip visitingCardUrl"
      )
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
