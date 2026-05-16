const express = require("express");
const router = express.Router();
const axios = require("axios"); // ✅ Delhivery API integration ke liye

const Razorpay = require("razorpay");
const Order = require("../models/orderModel");
const Product = require("../models/Product");
const ShippingSettings = require("../models/ShippingSettings");
const Setting = require("../models/settingModel");

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

// ✅ Notification Service
const { sendPushNotification } = require("../services/notificationService");
const { sendWhatsAppTemplate } = require("../services/whatsappService");
const { notifyAdminNewOrder } = require("../services/adminNotifyService");
const { sendPurchaseEvent } = require("../services/metaCapiService");
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
      // ✅ Lookup current product to pull the latest image (ImageKit)
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      {
        $addFields: {
          // Prefer the current product's first image; fallback to snapshot
          image: {
            $let: {
              vars: {
                prodImages: { $arrayElemAt: ["$product.images", 0] },
              },
              in: {
                $ifNull: [
                  { $arrayElemAt: ["$$prodImages", 0] },
                  "$image",
                ],
              },
            },
          },
          name: {
            $ifNull: [
              { $arrayElemAt: ["$product.name", 0] },
              "$name",
            ],
          },
        },
      },
      { $project: { product: 0 } },
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

    // Pagination support (default 50 per page, max 200)
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const [rawOrders, total] = await Promise.all([
      Order.find(filter)
        .populate("customerId", "firmName shopName otpMobile whatsapp city state zip visitingCardUrl address")
        .populate("items.productId", "sku mrp")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    const orders = rawOrders.map(attachSkuToItems);

    // If customerId is provided (customer fetching own orders), return plain array
    // so existing frontend code doesn't break. Otherwise return paginated object.
    if (customerId) {
      return res.json(orders);
    }

    res.json({
      orders,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
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
 *@desc     Create a new order & Notify Customer via WhatsApp
 */
router.post("/", async (req, res) => {
  try {
    const {
      customerId,
      items,
      paymentMode,
      paymentMethod,
      shippingAddress,
      razorpayPaymentId,
      paymentId,
      // total, itemsPrice, shippingPrice, codAdvancePaid, codRemainingAmount
      // are intentionally NOT destructured — backend recalculates them from DB
    } = req.body;

    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "CustomerId and non-empty items are required",
      });
    }

    const finalPaymentMethod = paymentMode || paymentMethod || "COD";
    const rzpPayId = razorpayPaymentId || paymentId || "";

    // ── SERVER-SIDE AMOUNT RECALCULATION ────────────────────────────────────
    // 1. Fetch current prices from DB (never trust client-supplied prices)
    const productIds = items.map((i) => i.productId).filter(Boolean);
    const products = await Product.find({ _id: { $in: productIds } }).select("price gstRate").lean();
    const priceMap = {};
    const gstRateMap = {};
    products.forEach((p) => { priceMap[String(p._id)] = p.price; gstRateMap[String(p._id)] = p.gstRate || 0; });

    // 2. itemsTotal (qty = inners × piecesPerUnit, already expanded by frontend)
    let serverItemsTotal = 0;
    for (const item of items) {
      const unitPrice = priceMap[String(item.productId)];
      if (unitPrice === undefined) {
        return res.status(400).json({ message: `Product not found: ${item.productId}` });
      }
      serverItemsTotal += unitPrice * (Number(item.qty) || 0);
    }

    // 3. Shipping from DB settings
    const shippingSettings = await ShippingSettings.findOne().lean();
    const flatRate = shippingSettings?.shippingCharge || 0;
    const freeAbove = shippingSettings?.freeShippingThreshold || 0;
    const serverShippingPrice = freeAbove > 0 && serverItemsTotal >= freeAbove ? 0 : flatRate;

    // 4. Discount from DB rules
    const discountRules = shippingSettings?.discountRules || [];
    let serverDiscountAmount = 0;
    const sortedRules = [...discountRules].sort((a, b) => b.minAmount - a.minAmount);
    const applicableRule = sortedRules.find((r) => serverItemsTotal >= r.minAmount);
    if (applicableRule) {
      serverDiscountAmount = Math.floor((serverItemsTotal * applicableRule.discountPercentage) / 100);
    }

    const serverGrandTotal = Math.max(0, serverItemsTotal + serverShippingPrice - serverDiscountAmount);

    // 5. COD advance: recalculate from server settings
    let serverAdvancePaid = 0;
    let serverRemainingAmount = serverGrandTotal;
    if (finalPaymentMethod === "COD" && rzpPayId) {
      const codSetting = await Setting.findOne({ key: "cod" }).lean();
      const codData = codSetting?.data || {};
      let advance = Number(codData.advanceAmount) || 0;
      if (codData.advanceType === "percentage") {
        advance = Math.floor((serverGrandTotal * advance) / 100);
      }
      serverAdvancePaid = Math.min(advance, serverGrandTotal);
      serverRemainingAmount = Math.max(serverGrandTotal - serverAdvancePaid, 0);
    }

    // 6. Verify Razorpay payment amount matches server-calculated amount
    if (rzpPayId) {
      const rzpPayment = await razorpayInstance.payments.fetch(rzpPayId);
      if (rzpPayment.status !== "captured") {
        return res.status(400).json({ message: "Payment not captured" });
      }
      const capturedRupees = rzpPayment.amount / 100;
      const expectedAmount = finalPaymentMethod === "ONLINE" ? serverGrandTotal : serverAdvancePaid;
      if (Math.abs(capturedRupees - expectedAmount) > 1) { // ₹1 rounding tolerance
        console.error(`FRAUD ALERT: Expected ₹${expectedAmount} but captured ₹${capturedRupees}. Customer: ${customerId}`);
        return res.status(400).json({ message: "Payment amount does not match order total" });
      }
    }
    // ── END SERVER-SIDE CALCULATION ──────────────────────────────────────────

    // ── Enrich items with server-side price and gstRate ──────────────────────
    const enrichedItems = items.map((item) => ({
      ...item,
      price: priceMap[String(item.productId)] ?? item.price,
      gstRate: gstRateMap[String(item.productId)] ?? 0,
    }));

    const order = new Order({
      customerId,
      items: enrichedItems,
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
      itemsPrice: serverItemsTotal,
      shippingPrice: serverShippingPrice,
      total: serverGrandTotal,
      paymentMode: finalPaymentMethod,
      razorpayPaymentId: rzpPayId,
      advancePaid: serverAdvancePaid,
      remainingAmount: serverRemainingAmount,
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

    // ============================================
    // 1. WHATSAPP ORDER CONFIRMATION
    // ============================================
    const to = sanitizePhone(populatedOrder.customerId?.whatsapp || populatedOrder.customerId?.otpMobile || populatedOrder.shippingAddress?.phone);

    if (to) {
      try {
        await sendWhatsAppTemplate({
          to,
          templateName: process.env.WA_ORDER_TEMPLATE || "order_confirmed_new",
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

    // ============================================
    // 2. ADMIN NEW-ORDER ALERT (WhatsApp + Email)
    // ============================================
    // Fire-and-forget — admin notification failure should NEVER block
    // the customer's order response. Errors are logged inside the service.
    notifyAdminNewOrder(populatedOrder).catch((e) =>
      console.error("Admin notify error:", e?.message)
    );

    // ✅ FIXED: Sending the response AFTER WhatsApp execution is complete!
    res.status(201).json({ order: populatedOrder });

    // ============================================
    // 3. META CONVERSIONS API (Purchase Event)
    // ============================================
    try {
      const metaSettingDoc = await Setting.findOne({ key: "meta-pixel" });
      if (metaSettingDoc && metaSettingDoc.data) {
        // Fire-and-forget CAPI request
        sendPurchaseEvent(populatedOrder, populatedOrder.customerId, metaSettingDoc.data, req).catch(e => 
          console.error("Meta CAPI inner error:", e.message)
        );
      }
    } catch (capiErr) {
      console.error("Meta CAPI fetch setting error:", capiErr.message);
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
          // Box dimensions map
          const BOX_DIMS = {
            A28: { length: 47,   breadth: 36,   height: 25   },
            A06: { length: 44.5, breadth: 35,   height: 34.5 },
            A08: { length: 47,   breadth: 35.5, height: 47   },
            A31: { length: 89,   breadth: 48,   height: 40   },
            A18: { length: 44,   breadth: 20,   height: 45   },
            B10: { length: 37.5, breadth: 23,   height: 35   }, // ✅ B10 added
          };

          // Har box type ko individual boxes mein expand karo
          // A28 qty:5 → 5 alag boxes, har ek ka apna shipment entry
          const individualBoxes = [];
          packingDetails.forEach(box => {
            const qty = Number(box.quantity) || 1;
            // Custom box → use admin-entered dims; standard box → lookup BOX_DIMS
            const dims = box.boxType === "custom"
              ? { length: Number(box.length) || 10, breadth: Number(box.breadth) || 10, height: Number(box.height) || 10 }
              : (BOX_DIMS[box.boxType] || { length: 47, breadth: 36, height: 25 });
            const perBoxWeightKg = (Number(box.totalWeight) || 0) / qty;
            // Volumetric vs actual — jo zyada ho
            const volWeightKg = (dims.length * dims.breadth * dims.height) / 5000;
            const chargeableKg = Math.max(perBoxWeightKg, volWeightKg);
            for (let i = 0; i < qty; i++) {
              individualBoxes.push({
                boxType: box.boxType,
                dims,
                weightGrams: Math.round(chargeableKg * 1000),
              });
            }
          });

          const addr = order.shippingAddress;
          const finalCity  = addr.isDifferentShipping ? addr.shippingCity    : addr.city;
          const finalState = addr.isDifferentShipping ? addr.shippingState   : addr.state;
          const finalPin   = addr.isDifferentShipping ? addr.shippingPincode : addr.pincode;
          const finalAdd   = addr.isDifferentShipping
            ? `${addr.shippingStreet}, ${addr.shippingArea}`
            : `${addr.street}, ${addr.area}`;
          const finalPhone = addr.phone || order.customerId?.otpMobile || "9999999999";
          const customerName = addr.shopName || addr.fullName || order.customerId?.shopName || "Customer";

          // COD amount — sirf pehle box pe, baaki prepaid
          let delhiveryCodAmount = 0;
          if (order.paymentMode === "COD") {
            delhiveryCodAmount = codAmountToCollect !== undefined
              ? codAmountToCollect
              : (order.remainingAmount || order.total);
          }

          // Har box ke liye ek shipment entry — ek API call mein sab AWB milenge
          const shipmentEntries = individualBoxes.map((box, idx) => ({
            name:         customerName,
            add:          finalAdd,
            pin:          finalPin,
            city:         finalCity,
            state:        finalState,
            country:      "India",
            phone:        finalPhone,
            // Box 1 = main order number, Box 2+ = ODR1001013-B2, B3...
            order:        idx === 0 ? order.orderNumber : `${order.orderNumber}-B${idx + 1}`,
            // Sirf pehle box pe COD — delivery agent wahan se collect karega
            payment_mode: idx === 0 && order.paymentMode === "COD" ? "COD" : "Prepaid",
            cod_amount:   idx === 0 ? delhiveryCodAmount : 0,
            total_amount: idx === 0 ? order.total : 0,
            products_desc: `Bafna Toys — Box ${idx + 1} of ${individualBoxes.length}`,
            seller_name:  "Bafna Toys",
            weight:       box.weightGrams,
            shipping_mode: "Surface",
            length:       box.dims.length,
            breadth:      box.dims.breadth,
            height:       box.dims.height,
          }));

          const response = await axios.post(
            "https://track.delhivery.com/api/cmu/create.json",
            `format=json&data=${encodeURIComponent(JSON.stringify({
              shipments: shipmentEntries,
              pickup_location: { name: process.env.DELHIVERY_PICKUP_LOCATION_NAME || "BAFNATOYS" },
            }))}`,
            { headers: { "Authorization": `Token ${process.env.DELHIVERY_API_KEY}`, "Content-Type": "application/x-www-form-urlencoded" } }
          );

          if (response.data && response.data.success) {
            const packages = response.data.packages || [];
            // Box 1 → main trackingId
            order.trackingId  = packages[0]?.waybill || "";
            order.courierName = "Delhivery";
            order.packingDetails = packingDetails;
            order.isShipped   = true;
            // Box 2+ → splitShipments array mein save karo
            if (packages.length > 1) {
              order.splitShipments = packages.slice(1).map((pkg, i) => ({
                awb:       pkg.waybill,
                boxNumber: i + 2,
                weightKg:  individualBoxes[i + 1].weightGrams / 1000,
                courier:   "Delhivery",
                createdAt: new Date(),
              }));
            }
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
          templateName: process.env.WA_ORDER_TEMPLATE || "order_confirmed_new",
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