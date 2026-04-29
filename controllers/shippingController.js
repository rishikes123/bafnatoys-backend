const axios = require("axios");
const Order = require("../models/orderModel");

const createShippingOrder = async (req, res) => {
  try {
    console.log("🚀 Shipping Process Started (FINAL + SAFE ADDRESS)...");

    const { orderId } = req.body;
    const order = await Order.findById(orderId).populate("customerId");
    if (!order) return res.status(404).json({ message: "Order not found" });

    const sa = order.shippingAddress;

    // ---------- SAFE DATA ----------
    const cleanPincode = String(sa.pincode).trim();
    const cleanPhone = String(sa.phone).replace(/\D/g, "").slice(-10);
    const warehouseId = String(process.env.ITHINK_WAREHOUSE_ID || "111217");
    const isCod = order.paymentMode === "COD";

    const today = new Date();
    const orderDate = `${String(today.getDate()).padStart(2, "0")}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${today.getFullYear()}`;

    // ✅ SAFE FULL ADDRESS (NO MORE ERRORS)
    const fullAddress = [
      sa.street,
      sa.area,
      sa.city,
      sa.state,
      sa.pincode
    ].filter(Boolean).join(", ");

    // ---------- FINAL PAYLOAD ----------
    const payload = {
      data: {
        shipments: [
          {
            waybill: "",
            order: order.orderNumber,
            sub_order: "",
            order_date: orderDate,
            total_amount: String(Math.round(order.total)),

            name: sa.fullName || "Customer",
            company_name: "Bafnatoys",
            add: fullAddress, // ✅ FIXED HERE
            pin: cleanPincode,
            city: sa.city,
            state: sa.state,
            country: "India",

            phone: cleanPhone,
            alt_phone: cleanPhone,
            email: "bafnatoys@gmail.com",

            // ✅ Billing (MANDATORY)
            is_billing_same_as_shipping: "yes",
            billing_name: sa.fullName || "Customer",
            billing_add: fullAddress,
            billing_pin: cleanPincode,
            billing_phone: cleanPhone,
            billing_alt_phone: cleanPhone,

            products: [
              {
                product_name: "Toys Order",
                product_sku: "TOYS",
                product_quantity: order.items.length || 1,
                product_price: String(Math.round(order.total))
              }
            ],

            shipment_length: "10",
            shipment_width: "10",
            shipment_height: "10",
            weight: "0.5",

            shipping_charges: "0",
            giftwrap_charges: "0",
            transaction_charges: "0",
            total_discount: "0",
            first_attemp_discount: "0",
            cod_charges: "0",
            advance_amount: "0",
            cod_amount: isCod ? String(Math.round(order.total)) : "0",

            payment_mode: isCod ? "COD" : "Prepaid",
            reseller_name: "",
            eway_bill_number: "",
            gst_number: "",
            return_address_id: warehouseId
          }
        ],

        pickup_address_id: warehouseId,
        access_token: process.env.ITHINK_ACCESS_TOKEN,
        secret_key: process.env.ITHINK_SECRET_KEY,
        logistics: "Delhivery",
        s_type: "surface",
        order_type: "forward"
      }
    };

    console.log("📦 FINAL PAYLOAD:", JSON.stringify(payload, null, 2));

    const response = await axios.post(
      "https://my.ithinklogistics.com/api_v3/order/add.json",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("📩 iThink Response:", response.data);

    if (response.data.status === "success") {
      const data = response.data.data[Object.keys(response.data.data)[0]];

      order.isShipped = true;
      order.trackingId = data.waybill;
      order.courierName = data.logistic_name;
      order.status = "shipped";
      await order.save();

      return res.status(200).json({ success: true, waybill: data.waybill });
    }

    return res.status(400).json({
      success: false,
      error: response.data.html_message || "Booking Failed"
    });

  } catch (err) {
    console.error("🔥 SHIPPING ERROR:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* =====================================================================
   CREATE SPLIT SHIPMENT — 2nd (or 3rd) box for same order
   POST /api/shipping/create-split
   Body: { orderId, boxNumber, packingDetails: [{boxType, quantity, totalWeight}] }
   Uses same Delhivery API as main ship flow.
   ===================================================================== */
const BOX_DIMS = {
  A28: { length: 47,   breadth: 36,   height: 25   },
  A06: { length: 44.5, breadth: 35,   height: 34.5 },
  A08: { length: 47,   breadth: 35.5, height: 47   },
  A31: { length: 89,   breadth: 48,   height: 40   },
  A18: { length: 44,   breadth: 20,   height: 45   },
};

const createSplitShipment = async (req, res) => {
  try {
    const { orderId, boxNumber = 2, packingDetails = [] } = req.body;
    if (!orderId) return res.status(400).json({ message: "orderId required" });
    if (!packingDetails.length) return res.status(400).json({ message: "packingDetails required" });

    const order = await Order.findById(orderId).populate("customerId");
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!order.trackingId) return res.status(400).json({ message: "Main box abhi shipped nahi hai. Pehle main shipment create karo." });

    const sa = order.shippingAddress;
    const finalCity  = sa.isDifferentShipping ? sa.shippingCity    : sa.city;
    const finalState = sa.isDifferentShipping ? sa.shippingState   : sa.state;
    const finalPin   = sa.isDifferentShipping ? sa.shippingPincode : sa.pincode;
    const finalAdd   = sa.isDifferentShipping
      ? `${sa.shippingStreet}, ${sa.shippingArea}`
      : `${sa.street}, ${sa.area}`;
    const finalPhone = String(sa.phone || order.customerId?.otpMobile || "9999999999").replace(/\D/g, "").slice(-10);

    // Calculate total weight (grams) and pick largest box dims
    let totalWeightKg = 0;
    let finalLength = 47, finalBreadth = 36, finalHeight = 25;
    packingDetails.forEach((box) => {
      totalWeightKg += Number(box.totalWeight) || 0;
      const dims = BOX_DIMS[box.boxType];
      if (dims) { finalLength = dims.length; finalBreadth = dims.breadth; finalHeight = dims.height; }
    });
    const totalWeightGrams = totalWeightKg * 1000;

    const subOrderId = `${order.orderNumber}-B${boxNumber}`;

    const delhiveryData = {
      shipments: [{
        name:         sa.shopName || sa.fullName || order.customerId?.shopName || "Customer",
        add:          finalAdd,
        pin:          finalPin,
        city:         finalCity,
        state:        finalState,
        country:      "India",
        phone:        finalPhone,
        order:        subOrderId,
        payment_mode: "Prepaid",   // 2nd box always prepaid — COD already on box 1
        cod_amount:   0,
        products_desc: `Box ${boxNumber} — ${order.orderNumber}`,
        seller_name:  "Bafna Toys",
        total_amount: 0,
        weight:       totalWeightGrams,
        shipping_mode: "Surface",
        length:       finalLength,
        breadth:      finalBreadth,
        height:       finalHeight,
      }],
      pickup_location: { name: process.env.DELHIVERY_PICKUP_LOCATION_NAME || "BAFNATOYS" },
    };

    const response = await axios.post(
      "https://track.delhivery.com/api/cmu/create.json",
      `format=json&data=${encodeURIComponent(JSON.stringify(delhiveryData))}`,
      { headers: { Authorization: `Token ${process.env.DELHIVERY_API_KEY}`, "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (response.data && response.data.success) {
      const newAwb = response.data.packages[0].waybill;

      order.splitShipments = order.splitShipments || [];
      order.splitShipments.push({
        awb:       newAwb,
        boxNumber,
        weightKg:  totalWeightKg,
        courier:   "Delhivery",
        createdAt: new Date(),
      });
      await order.save();

      return res.json({ success: true, awb: newAwb, boxNumber, subOrderId });
    }

    console.error("Delhivery split rejected:", response.data);
    return res.status(400).json({
      success: false,
      error: response.data?.rmk || response.data?.error || "Delhivery API ne reject kiya",
    });
  } catch (err) {
    console.error("🔥 SPLIT SHIPMENT ERROR:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
};

module.exports = { createShippingOrder, createSplitShipment };
