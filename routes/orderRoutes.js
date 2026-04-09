const express = require("express");
const router = express.Router();
const axios = require("axios"); // ✅ Delhivery API integration ke liye

const Order = require("../models/orderModel");
const Product = require("../models/Product");
const sendEmail = require("../utils/sendEmail");

// ✅ Notification Service
const { sendPushNotification } = require("../services/notificationService");
const Registration = require("../models/Registration");

// ✅ Phone sanitizer (India)
function sanitizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");

  // remove leading 0 (0987... => 987...)
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  // if 10 digits => add 91
  if (digits.length === 10) digits = "91" + digits;

  return digits; // final: 9198xxxxxxxx
}

// ✅ HELPER FUNCTION: Har order item ke sath uska SKU aur MRP attach karne ke liye
const attachSkuToItems = (order) => {
  if (order && order.items && Array.isArray(order.items)) {
    order.items = order.items.map(item => {
      return {
        ...item,
        // Backend se explicitly SKU aur MRP utha kar bhej rahe hain
        sku: (item.productId && item.productId.sku) ? item.productId.sku : (item.sku || ""),
        mrp: (item.productId && item.productId.mrp) ? item.productId.mrp : (item.mrp || 0) // ✅ Added MRP here
      };
    });
  }
  return order;
};

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

    let orders = await Order.find(filter)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl address")
      .populate("items.productId", "sku mrp") // ✅ YAHAN SKU KE SATH MRP BHI ADD KIYA HAI
      .sort({ createdAt: -1 })
      .lean();

    // ✅ SKU and MRP Attach kar rahe hain
    orders = orders.map(attachSkuToItems);

    res.json(orders);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while fetching orders",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    let order = await Order.findById(req.params.id)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl address")
      .populate("items.productId", "sku mrp") // ✅ YAHAN MRP ADD KIYA HAI
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });
    
    // ✅ SKU and MRP Attach kar rahe hain
    order = attachSkuToItems(order);

    res.json(order);
  } catch (err) {
    res.status(500).json({
      message: err.message || "Server error while fetching order details",
    });
  }
});

/**
 *@route    POST /api/orders
 *@desc     Create a new order & Notify Admin via Email + Customer via WhatsApp
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
      shippingAddress: {
        shopName: shippingAddress?.shopName || "",
        fullName: shippingAddress?.fullName || "",
        phone: shippingAddress?.phone || "",
        street: shippingAddress?.street || "",
        area: shippingAddress?.area || "",
        city: shippingAddress?.city || "",
        state: shippingAddress?.state || "",
        pincode: shippingAddress?.pincode || "",
        type: shippingAddress?.type || "Home",
        gstNumber: shippingAddress?.gstNumber || "",
        isDifferentShipping: shippingAddress?.isDifferentShipping || false,
        shippingStreet: shippingAddress?.shippingStreet || "",
        shippingArea: shippingAddress?.shippingArea || "",
        shippingPincode: shippingAddress?.shippingPincode || "",
        shippingCity: shippingAddress?.shippingCity || "",
        shippingState: shippingAddress?.shippingState || "",
      },

      itemsPrice: itemsPrice || 0,
      shippingPrice: shippingPrice || 0,
      total: total,

      paymentMode: finalPaymentMethod,
      advancePaid: codAdvancePaid || 0,
      remainingAmount: codRemainingAmount || 0,

      wa: {
        orderConfirmedSent: false,
        trackingSent: false,
        lastError: "",
        lastSentAt: null,
      }
    });

    const MAX_TRIES = 5;
    let savedOrder = null;

    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        savedOrder = await order.save();
        break;
      } catch (e) {
        if (e?.code === 11000 && String(e.message).includes("orderNumber")) {
          // ✅ NEW LOGIC: Updated to 1001001 for correct sequence bypassing random big numbers
          const lastOrderRetry = await Order.findOne().sort({ createdAt: -1 });
          let nextNum = 1001001;
          
          if (lastOrderRetry && lastOrderRetry.orderNumber) {
            const lastNumber = parseInt(lastOrderRetry.orderNumber.replace("ODR", ""), 10);
            if (!isNaN(lastNumber) && lastNumber >= 1001000) {
              nextNum = lastNumber + 1;
            }
          }
          
          order.orderNumber = "ODR" + nextNum;
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

    let populatedOrder = await Order.findById(savedOrder._id)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl")
      .populate("items.productId", "sku mrp") // ✅ YAHAN MRP ADD KIYA HAI
      .lean();

    // ✅ SKU and MRP Attach kar rahe hain
    populatedOrder = attachSkuToItems(populatedOrder);

    res.status(201).json({ order: populatedOrder });

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
          <p>Please check the admin panel for more details.</p>
        </div>
      `;

      sendEmail({ to: adminEmail, subject: emailSubject, html: emailMessage }).catch((err) => {
        console.error("Background Email Error:", err.message);
      });
    }

    const to = sanitizePhone(populatedOrder.customerId?.whatsapp || populatedOrder.customerId?.otpMobile || populatedOrder.shippingAddress?.phone);

    if (to) {
      try {
        await sendWhatsAppTemplate({
          to,
          templateName: "order_confirmed_new",
          languageCode: "en_US",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: String(populatedOrder.customerId?.shopName || populatedOrder.customerId?.firmName || "Customer") },
                { type: "text", text: String(populatedOrder.orderNumber || "") },
                { type: "text", text: String(populatedOrder.total ?? "") },
              ],
            },
          ],
        });

        await Order.findByIdAndUpdate(savedOrder._id, {
          "wa.orderConfirmedSent": true,
          "wa.lastSentAt": new Date(),
          "wa.lastError": ""
        });
      } catch (waErr) {
        console.error("Immediate WhatsApp Error:", waErr?.response?.data || waErr.message);
        await Order.findByIdAndUpdate(savedOrder._id, {
          "wa.lastError": "Immediate WhatsApp failed"
        });
      }
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
    // 👇 Yahan manualAdvance aur codAmountToCollect ko req.body se nikala hai
    const { status, trackingId, courierName, cancelledBy, packingDetails, manualAdvance, codAmountToCollect } = req.body;
    if (!status) return res.status(400).json({ message: "Status is required" });

    const newStatus = String(status).toLowerCase();
    const allowedStatuses = ["pending", "processing", "shipped", "delivered", "cancelled", "returned"];
    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

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

    // ✅ YAHAN FIX ADD KIYA HAI TAQI ORDER STATUS SAHI SE DATABASE MEIN SAVE HO
    order.status = newStatus;

    /* ============================================================
        🚚 SHIPPING & EXCLUSIVE DELHIVERY AUTO-AWB GENERATION
    ============================================================ */
    if (newStatus === "shipped") {
      if (courierName === "Delhivery" && packingDetails && packingDetails.length > 0 && !order.trackingId) {
        try {
          let totalWeightKg = 0;
          
          // ✅ Box Dimensions Setup Default
          let finalLength = 47;  
          let finalBreadth = 36; 
          let finalHeight = 25;  

          // 👇 Yahan Naye Boxes A31, A08, A06, A28 aur A18 ki actual dimension logic daali hai
          packingDetails.forEach(box => { 
            totalWeightKg += Number(box.totalWeight) || 0; 
            
            if (box.boxType === "A28") {
                finalLength = 47;
                finalBreadth = 36;
                finalHeight = 25;
            } else if (box.boxType === "A06") {
                finalLength = 44.5;
                finalBreadth = 35;
                finalHeight = 34.5;
            } else if (box.boxType === "A08") {
                finalLength = 47;
                finalBreadth = 35.5;
                finalHeight = 47;
            } else if (box.boxType === "A31") {
                finalLength = 89;
                finalBreadth = 48;
                finalHeight = 40;
            } else if (box.boxType === "A18") { // ✅ A18 YAHAN ADD HUA HAI
                finalLength = 44;
                finalBreadth = 20; // W hai toh breadth banega
                finalHeight = 45;
            }
          });
          
          const totalWeightGrams = totalWeightKg * 1000;

          const addr = order.shippingAddress;
          const finalCity = addr.isDifferentShipping ? addr.shippingCity : addr.city;
          const finalState = addr.isDifferentShipping ? addr.shippingState : addr.state;
          const finalPin = addr.isDifferentShipping ? addr.shippingPincode : addr.pincode;
          const finalAdd = addr.isDifferentShipping ? `${addr.shippingStreet}, ${addr.shippingArea}` : `${addr.street}, ${addr.area}`;
          const finalPhone = addr.phone || order.customerId?.otpMobile || "9999999999";

          // 👇 Yahan par COD amount bhejne ki logic fix ki hai
          let delhiveryCodAmount = 0;
          if (order.paymentMode === "COD") {
            if (codAmountToCollect !== undefined) {
              delhiveryCodAmount = codAmountToCollect; // Agar front-end se reduced amount aayi hai
            } else {
              delhiveryCodAmount = order.remainingAmount; // Default fallback
            }
          }

          const delhiveryPayload = {
            format: "json",
            data: {
              shipments: [{
                name: addr.shopName || addr.fullName || order.customerId?.shopName || "Customer",
                add: finalAdd,
                pin: finalPin,
                city: finalCity,
                state: finalState,
                country: "India",
                phone: finalPhone,
                order: order.orderNumber,
                payment_mode: order.paymentMode === "COD" ? "COD" : "Prepaid",
                cod_amount: delhiveryCodAmount, // ✅ Updated amount here
                products_desc: "Bafna Toys Products",
                seller_name: "Bafna Toys", 
                total_amount: order.total,
                weight: totalWeightGrams,
                shipping_mode: "Surface",
                
                // ✅ DIMENSIONS SENT TO DELHIVERY
                length: finalLength,
                breadth: finalBreadth,
                height: finalHeight
              }],
              pickup_location: { name: process.env.DELHIVERY_PICKUP_LOCATION_NAME || "BAFNATOYS" }
            }
          };

          const response = await axios.post("https://track.delhivery.com/api/cmu/create.json", 
            `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryPayload.data))}`, 
            { headers: { "Authorization": `Token ${process.env.DELHIVERY_API_KEY}`, "Content-Type": "application/x-www-form-urlencoded" } }
          );

          if (response.data && response.data.success) {
            order.trackingId = response.data.packages[0].waybill;
            order.courierName = "Delhivery";
            order.packingDetails = packingDetails;
            order.isShipped = true;
          } else {
             console.error("Delhivery API Rejected:", response.data);
             return res.status(400).json({ message: "Delhivery API Error: " + JSON.stringify(response.data.error || response.data.rmk) });
          }
        } catch (apiErr) {
          console.error("Delhivery API Failed:", apiErr.message);
          return res.status(500).json({ message: "Failed to connect to Delhivery API." });
        }
      } 
      
      // Fallback
      if (trackingId && !order.trackingId) {
        order.trackingId = trackingId;
        order.courierName = courierName || "Delhivery";
        order.isShipped = true;
      }
    }

    if (newStatus === "cancelled" && cancelledBy) {
      order.cancelledBy = cancelledBy;
    }

    if (!order.wa) {
      order.wa = {
        orderConfirmedSent: false,
        trackingSent: false,
        lastError: "",
        lastSentAt: null,
      };
    }

    // 👇 Agar manual paise receive hue hain toh DB update karo taaki invoice mein accurate ho
    if (manualAdvance !== undefined && codAmountToCollect !== undefined) {
      order.advancePaid = manualAdvance;
      order.remainingAmount = codAmountToCollect;
    }

    await order.save();

    /* ============================================================
        🔔 Push Notification Trigger
    ============================================================ */
    if (order.customerId?.expoPushToken) {
      let title = "Order Update";
      let body = `Your order ${order.orderNumber} is now ${newStatus.toUpperCase()}.`;
      
      if (newStatus === "shipped") {
        body = `🚚 Your order ${order.orderNumber} has been shipped! Tracking ID: ${order.trackingId}`;
      } else if (newStatus === "delivered") {
        body = `✅ Your order ${order.orderNumber} has been delivered. Enjoy your toys!`;
      } else if (newStatus === "cancelled") {
        body = `❌ Your order ${order.orderNumber} has been cancelled.`;
      }

      // Pass the first product image URL if available
      const imageUrl = order.items && order.items.length > 0 && order.items[0].image ? order.items[0].image : null;
      
      sendPushNotification([order.customerId.expoPushToken], title, body, { orderId: order._id }, imageUrl).catch(e => {
        console.error("Push Notification Error:", e.message);
      });
    }

    /* ============================================================
        💬 WhatsApp Trigger
    ============================================================ */
    const to = sanitizePhone(order.customerId?.whatsapp || order.customerId?.otpMobile || order.shippingAddress?.phone);

    // ✅ ORDER CONFIRMED
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

    // ✅ ORDER SHIPPED
    if (to && newStatus === "shipped" && order.trackingId && !order.wa.trackingSent) {
      try {
        let dynamicTrackingLink = `https://www.delhivery.com/track-v2/package/${order.trackingId}`;

        await sendWhatsAppTemplate({
          to,
          templateName: process.env.WA_TRACKING_TEMPLATE || "shipped", 
          languageCode: "en_US",
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: String(order.customerId?.shopName || order.customerId?.firmName || "Customer") }, // {{1}}
                { type: "text", text: String(order.orderNumber || "") }, // {{2}}
                { type: "text", text: "Delhivery" }, // {{3}} 
                { type: "text", text: String(order.trackingId || "") },  // {{4}}
                { type: "text", text: String(dynamicTrackingLink) }, // {{5}} 
              ],
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [
                {
                  type: "text",
                  text: String(order._id) 
                }
              ]
            }
          ],
        });

        order.wa.trackingSent = true;
        order.wa.lastSentAt = new Date();
        order.wa.lastError = "";
        await order.save();
      } catch (e) {
        console.error("WhatsApp shipped Error Data: ", e.response?.data);
        order.wa.lastError = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || "WhatsApp shipped failed";
        await order.save();
      }
    }

    let populatedOrder = await Order.findById(order._id)
      .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl")
      .populate("items.productId", "sku mrp") // ✅ YAHAN BHI MRP ADD KIYA HAI
      .lean();

    // ✅ SKU and MRP Attach kar rahe hain
    populatedOrder = attachSkuToItems(populatedOrder);

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