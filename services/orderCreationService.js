const Razorpay = require("razorpay");

const Order = require("../models/orderModel");
const Product = require("../models/Product");
const ShippingSettings = require("../models/ShippingSettings");
const Setting = require("../models/settingModel");
const { sendWhatsAppTemplate } = require("./whatsappService");
const { notifyAdminNewOrder } = require("./adminNotifyService");
const { sendPurchaseEvent } = require("./metaCapiService");

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

class OrderCreationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OrderCreationError";
    this.statusCode = statusCode;
  }
}

function sanitizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

function attachSkuToItems(order) {
  if (!order || !Array.isArray(order.items)) return order;
  order.items = order.items.map((item) => ({
    ...item,
    sku: item.productId?.sku || item.sku || "",
    mrp: item.productId?.mrp || item.mrp || 0,
  }));
  return order;
}

async function populateOrder(orderId) {
  let order = await Order.findById(orderId)
    .populate(
      "customerId",
      "firmName shopName otpMobile whatsapp city state zip visitingCardUrl email"
    )
    .populate("items.productId", "sku mrp")
    .lean();
  return attachSkuToItems(order);
}

async function sendOrderNotifications(order, req) {
  const to = sanitizePhone(
    order.customerId?.whatsapp ||
      order.customerId?.otpMobile ||
      order.shippingAddress?.phone
  );

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
              {
                type: "text",
                text: String(
                  order.customerId?.shopName ||
                    order.customerId?.firmName ||
                    "Customer"
                ),
              },
              { type: "text", text: String(order.orderNumber || "") },
              { type: "text", text: String(order.total ?? "") },
            ],
          },
        ],
      });
      await Order.findByIdAndUpdate(order._id, {
        "wa.orderConfirmedSent": true,
        "wa.lastSentAt": new Date(),
        "wa.lastError": "",
      });
    } catch (error) {
      console.error(
        "Immediate WhatsApp Error:",
        error?.response?.data || error.message
      );
      await Order.findByIdAndUpdate(order._id, {
        "wa.lastError": "Immediate WhatsApp failed",
      });
    }
  }

  notifyAdminNewOrder(order).catch((error) =>
    console.error("Admin notify error:", error?.message)
  );

  try {
    const metaSettingDoc = await Setting.findOne({ key: "meta-pixel" });
    if (metaSettingDoc?.data) {
      sendPurchaseEvent(
        order,
        order.customerId,
        metaSettingDoc.data,
        req
      ).catch((error) =>
        console.error("Meta CAPI inner error:", error.message)
      );
    }
  } catch (error) {
    console.error("Meta CAPI fetch setting error:", error.message);
  }
}

async function createOrderFromPayload(payload, options = {}) {
  const {
    customerId,
    items,
    paymentMode,
    paymentMethod,
    shippingAddress,
    razorpayPaymentId,
    razorpayOrderId,
    paymentId,
  } = payload || {};

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    throw new OrderCreationError(
      "CustomerId and non-empty items are required",
      400
    );
  }

  const finalPaymentMethod = paymentMode || paymentMethod || "COD";
  const rzpPayId = razorpayPaymentId || paymentId || "";

  // A retry from the browser, webhook, or recovery worker must return the
  // original order instead of creating a second one.
  if (rzpPayId) {
    const existingOrder = await Order.findOne({
      razorpayPaymentId: rzpPayId,
    }).lean();
    if (existingOrder) {
      return {
        order: await populateOrder(existingOrder._id),
        alreadyExists: true,
      };
    }
  }

  const productIds = items.map((item) => item.productId).filter(Boolean);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("price gstRate")
    .lean();
  const priceMap = {};
  const gstRateMap = {};
  products.forEach((product) => {
    priceMap[String(product._id)] = product.price;
    gstRateMap[String(product._id)] = product.gstRate || 0;
  });

  let serverItemsTotal = 0;
  for (const item of items) {
    const unitPrice = priceMap[String(item.productId)];
    if (unitPrice === undefined) {
      throw new OrderCreationError(
        `Product not found: ${item.productId}`,
        400
      );
    }
    const qty = Number(item.qty) || 0;
    if (qty <= 0) {
      throw new OrderCreationError(
        `Invalid quantity for product: ${item.productId}`,
        400
      );
    }
    serverItemsTotal += unitPrice * qty;
  }

  const shippingSettings = await ShippingSettings.findOne().lean();
  const flatRate = shippingSettings?.shippingCharge || 0;
  const freeAbove = shippingSettings?.freeShippingThreshold || 0;
  const serverShippingPrice =
    freeAbove > 0 && serverItemsTotal >= freeAbove ? 0 : flatRate;

  const discountRules = shippingSettings?.discountRules || [];
  const sortedRules = [...discountRules].sort(
    (a, b) => b.minAmount - a.minAmount
  );
  const applicableRule = sortedRules.find(
    (rule) => serverItemsTotal >= rule.minAmount
  );
  const serverDiscountAmount = applicableRule
    ? Math.floor(
        (serverItemsTotal * applicableRule.discountPercentage) / 100
      )
    : 0;
  const serverGrandTotal = Math.max(
    0,
    serverItemsTotal + serverShippingPrice - serverDiscountAmount
  );

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
    serverRemainingAmount = Math.max(
      serverGrandTotal - serverAdvancePaid,
      0
    );
  }

  if (rzpPayId) {
    const rzpPayment = await razorpayInstance.payments.fetch(rzpPayId);
    if (rzpPayment.status !== "captured") {
      throw new OrderCreationError("Payment not captured", 400);
    }
    if (razorpayOrderId && rzpPayment.order_id !== razorpayOrderId) {
      throw new OrderCreationError(
        "Payment does not belong to this Razorpay order",
        400
      );
    }

    const capturedRupees = rzpPayment.amount / 100;
    if (razorpayOrderId) {
      const rzpOrder = await razorpayInstance.orders.fetch(razorpayOrderId);
      const expectedRupees = rzpOrder.amount / 100;
      if (Math.abs(capturedRupees - expectedRupees) > 1) {
        throw new OrderCreationError(
          "Payment amount does not match order total",
          400
        );
      }
    } else {
      const expectedAmount =
        finalPaymentMethod === "ONLINE"
          ? serverGrandTotal
          : serverAdvancePaid;
      if (Math.abs(capturedRupees - expectedAmount) > 5) {
        throw new OrderCreationError(
          "Payment amount does not match order total",
          400
        );
      }
    }

    if (finalPaymentMethod === "COD") {
      serverAdvancePaid = capturedRupees;
      serverRemainingAmount = Math.max(
        serverGrandTotal - serverAdvancePaid,
        0
      );
    }
  }

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
      isDifferentShipping:
        shippingAddress?.isDifferentShipping || false,
      shippingStreet: shippingAddress?.shippingStreet || "",
      shippingArea: shippingAddress?.shippingArea || "",
      shippingPincode: shippingAddress?.shippingPincode || "",
      shippingCity: shippingAddress?.shippingCity || "",
      shippingState: shippingAddress?.shippingState || "",
    },
    itemsPrice: serverItemsTotal,
    shippingPrice: serverShippingPrice,
    discountAmount: serverDiscountAmount,
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
    },
  });

  let savedOrder = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      savedOrder = await order.save();
      break;
    } catch (error) {
      if (
        error?.code === 11000 &&
        String(error.message).includes("orderNumber")
      ) {
        const lastOrder = await Order.findOne().sort({ createdAt: -1 });
        let nextNumber = 1001001;
        if (lastOrder?.orderNumber) {
          const parsed = parseInt(
            lastOrder.orderNumber.replace("ODR", ""),
            10
          );
          if (!Number.isNaN(parsed) && parsed >= 1001000) {
            nextNumber = parsed + 1;
          }
        }
        order.orderNumber = `ODR${nextNumber}`;
        continue;
      }
      throw error;
    }
  }

  if (!savedOrder) {
    throw new OrderCreationError(
      "Could not create order after several attempts",
      500
    );
  }

  const populatedOrder = await populateOrder(savedOrder._id);

  // The order is already safely stored. Notifications must never roll it back
  // or delay the customer response.
  setImmediate(() => {
    sendOrderNotifications(populatedOrder, options.req).catch((error) =>
      console.error("Order notification error:", error.message)
    );
  });

  return { order: populatedOrder, alreadyExists: false };
}

module.exports = {
  OrderCreationError,
  createOrderFromPayload,
};
