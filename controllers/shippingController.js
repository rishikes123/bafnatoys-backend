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

module.exports = { createShippingOrder };
