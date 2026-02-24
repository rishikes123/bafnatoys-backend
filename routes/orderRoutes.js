// routes/orderRoutes.js
const express = require("express");
const router = express.Router();

const Order = require("../models/orderModel");
const Product = require("../models/Product");
const sendEmail = require("../utils/sendEmail");

// ✅ WhatsApp Service (Meta Cloud API)
const { sendWhatsAppTemplate } = require("../services/whatsappService");

// ✅ Phone sanitizer (India)
function sanitizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");

  // remove leading 0 (0987... => 987...)
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  // if 10 digits => add 91
  if (digits.length === 10) digits = "91" + digits;

  return digits; // final: 9198xxxxxxxx
}

/* ============================================================
    ✅ ANALYTICS ROUTES (Must be before /:id)
============================================================ */
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
router.get("/", async (req, res) => {
  try {
    const { customerId } = req.query;
    const filter = customerId ? { customerId } : {};

    const orders = await Order.find(filter)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl address")
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while fetching orders",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl address")
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
 * @route    POST /api/orders
 * @desc     Create a new order & Notify Admin via Email
 */
router.post("/", async (req, res) => {
  try {
    const {
      customerId,
      items,
      total,
      paymentMode,
      paymentMethod,
      shippingAddress,

      codAdvancePaid,
      codRemainingAmount,

      itemsPrice,
      shippingPrice,
    } = req.body;

    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "CustomerId and non-empty items are required",
      });
    }

    const finalPaymentMethod = paymentMode || paymentMethod || "COD";

    const order = new Order({
      customerId,
      items,
      shippingAddress: shippingAddress || {},

      itemsPrice: itemsPrice || 0,
      shippingPrice: shippingPrice || 0,
      total: total,

      paymentMode: finalPaymentMethod,
      advancePaid: codAdvancePaid || 0,
      remainingAmount: codRemainingAmount || 0,
    });

    const MAX_TRIES = 5;
    let savedOrder = null;

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
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl")
      .lean();

    // ✅ respond fast
    res.status(201).json({ order: populatedOrder });

    // ✅ email in background
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const emailSubject = `🚀 New Order Alert: ${populatedOrder.orderNumber}`;

      const emailMessage = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; max-width: 600px;">
          <h2 style="color: #27ae60;">New Order Received! 🎉</h2>
          <p><strong>Order ID:</strong> ${populatedOrder.orderNumber}</p>
          <p><strong>Customer:</strong> ${populatedOrder.customerId?.shopName || "Guest"} (${populatedOrder.customerId?.city || ""})</p>
          <p><strong>Mobile:</strong> ${populatedOrder.customerId?.otpMobile || "N/A"}</p>
          <p><strong>Total Amount:</strong> ₹${populatedOrder.total}</p>
          <p><strong>Payment Mode:</strong> ${populatedOrder.paymentMode}</p>

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

      sendEmail({ to: adminEmail, subject: emailSubject, html: emailMessage }).catch((err) => {
        console.error("Background Email Error:", err.message);
      });
    }
  } catch (err) {
    console.error("Order Creation Error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        message: err.message || "Server error while creating order",
      });
    }
  }
});

/* ============================================================
    ✅ RETURN REQUEST ROUTES
============================================================ */
router.put("/return/:id", async (req, res) => {
  try {
    const { reason, description, images, video } = req.body;
    const order = await Order.findById(req.params.id);

    if (order) {
      if (order.status !== "delivered") {
        return res.status(400).send({ message: "Order must be delivered to request return." });
      }

      order.returnRequest = {
        isRequested: true,
        status: "Pending",
        reason,
        description,
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
    ✅ STATUS & TRACKING UPDATE + WHATSAPP TRIGGERS
============================================================ */
const updateOrderStatus = async (req, res) => {
  try {
    const { status, trackingId, courierName, cancelledBy } = req.body;
    if (!status) return res.status(400).json({ message: "Status is required" });

    const newStatus = String(status).toLowerCase();
    const allowedStatuses = ["pending", "processing", "shipped", "delivered", "cancelled", "returned"];
    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    // ✅ populate customer for WhatsApp
    const order = await Order.findById(req.params.id).populate("customerId");
    if (!order) return res.status(404).json({ message: "Order not found" });

    /* ✅ STOCK REDUCTION (on delivered) */
    if (newStatus === "delivered" && order.status !== "delivered") {
      if (Array.isArray(order.items)) {
        for (const item of order.items) {
          const productId = item.productId?._id || item.productId;
          const qty = Number(item.qty) || 0;
          if (productId && qty > 0) {
            await Product.findByIdAndUpdate(productId, { $inc: { stock: -qty } });
          }
        }
      }
      order.isDelivered = true;
      order.deliveredAt = Date.now();
    }

    /* ✅ TRACKING FIELDS (on shipped) */
    if (newStatus === "shipped") {
      if (trackingId) order.trackingId = trackingId;
      if (courierName) order.courierName = courierName;
      order.isShipped = true;
    }

    /* ✅ CANCEL INFO */
    if (newStatus === "cancelled" && cancelledBy) {
      order.cancelledBy = cancelledBy;
    }

    // Ensure wa object exists
    if (!order.wa) {
      order.wa = {
        orderConfirmedSent: false,
        trackingSent: false,
        lastError: "",
        lastSentAt: null,
      };
    }

    // Save status
    order.status = newStatus;
    await order.save();

    /* ============================================================
        ✅ WhatsApp Trigger
        NOTE:
        - order_confirmed_new : numeric vars {{1}} {{2}} {{3}} => NO parameter_name
        - order_dispatch_v1   : named vars => parameter_name REQUIRED
    ============================================================ */
    const to = sanitizePhone(order.customerId?.whatsapp || order.customerId?.otpMobile || order.shippingAddress?.phone);

    // ✅ ORDER CONFIRMED (processing) -> Template: order_confirmed_new (numeric placeholders)
    if (to && newStatus === "processing" && !order.wa.orderConfirmedSent) {
      try {
        await sendWhatsAppTemplate({
          to,
          templateName: "order_confirmed_new",
          languageCode: "en_US",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: String(order.customerId?.shopName || order.customerId?.firmName || "Customer") },
                { type: "text", text: String(order.orderNumber || "") },
                { type: "text", text: String(order.total ?? "") },
              ],
            },
          ],
        });

        order.wa.orderConfirmedSent = true;
        order.wa.lastSentAt = new Date();
        order.wa.lastError = "";
        await order.save();
      } catch (e) {
        order.wa.lastError = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || "WhatsApp confirm failed";
        await order.save();
      }
    }

    // ✅ ORDER SHIPPED -> Template: order_dispatch_v1 (named placeholders)
    if (to && newStatus === "shipped" && order.trackingId && order.courierName && !order.wa.trackingSent) {
      try {
        // 🔗 SMART TRACKING LINK LOGIC
        let dynamicTrackingLink = "https://google.com";
        const cName = String(order.courierName).toLowerCase().trim();

        if (cName.includes("delhivery")) {
          dynamicTrackingLink = "https://www.delhivery.com/tracking";
        } else if (cName.includes("vxpress") || cName.includes("v-xpress") || cName.includes("v xpress")) {
          dynamicTrackingLink = "https://vxpress.in/track-result/";
        }

        await sendWhatsAppTemplate({
          to,
          templateName: "order_dispatch_v1",
          languageCode: "en_US",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", parameter_name: "shop_name", text: String(order.customerId?.shopName || order.customerId?.firmName || "Customer") },
                { type: "text", parameter_name: "order_id", text: String(order.orderNumber || "") },
                { type: "text", parameter_name: "courier_name", text: String(order.courierName || "") },
                { type: "text", parameter_name: "tracking_id", text: String(order.trackingId || "") },
                { type: "text", parameter_name: "tracking_link", text: String(dynamicTrackingLink || "") },
              ],
            },
          ],
        });

        order.wa.trackingSent = true;
        order.wa.lastSentAt = new Date();
        order.wa.lastError = "";
        await order.save();
      } catch (e) {
        order.wa.lastError = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || "WhatsApp shipped failed";
        await order.save();
      }
    }

    const populatedOrder = await Order.findById(order._id)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl")
      .lean();

    res.json(populatedOrder);
  } catch (err) {
    console.error("Status Update Error:", err);
    res.status(500).json({ message: err.message || "Server error while updating status" });
  }
};

router.put("/:id/status", updateOrderStatus);
router.patch("/:id/status", updateOrderStatus);

router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json({ ok: true, message: "Order deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error while deleting order" });
  }
});

module.exports = router;