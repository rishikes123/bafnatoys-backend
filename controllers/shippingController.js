const axios = require("axios");
const Order = require("../models/orderModel");

const createShippingOrder = async (req, res) => {
  try {
    console.log("🚀 Shipping Process Started (FINAL VERIFIED CODE)...");
    const { orderId } = req.body;

    const order = await Order.findById(orderId).populate('customerId');
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // ---------- 1. ACCURATE MATH & PRODUCT MAPPING ----------
    let calculatedTotal = 0;
    const cleanProducts = order.items.map(item => {
      const q = parseInt(item.qty || 0); // Schema based 'qty'
      const p = parseFloat(item.price || 0);
      calculatedTotal += (p * q);

      return {
        "product_name": item.name || "Toys Order",
        "product_sku": "TOYS",
        "product_quantity": String(q > 0 ? q : 1), 
        "product_price": String(Math.round(p)),
        "product_tax_rate": "0",
        "product_hsn_code": "",
        "product_discount": "0"
      };
    });

    // iThink system calculation must match: price * qty
    const finalTotalStr = String(Math.round(calculatedTotal));

    // ---------- 2. DATA CLEANING ----------
    const cleanPincode = String(order.shippingAddress.pincode).trim();
    const cleanPhone = String(order.shippingAddress.phone).replace(/\D/g, "").slice(-10);
    const today = new Date();
    const orderDate = `${String(today.getDate()).padStart(2, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}-${today.getFullYear()}`;
    const warehouseId = String(process.env.ITHINK_WAREHOUSE_ID || "111217");
    const isCod = order.paymentMode === "COD";

    // ---------- 3. FINAL PAYLOAD (Strict Doc Compliance) ----------
    const payload = {
      "data": {
        "shipments": [
          {
            "waybill": "",
            "order": order.orderNumber,
            "sub_order": "",
            "order_date": orderDate,
            "total_amount": finalTotalStr,
            "name": order.shippingAddress.fullName,
            "company_name": "Bafnatoys",
            "add": order.shippingAddress.street,
            "pin": cleanPincode,
            "city": order.shippingAddress.city || "New Delhi",
            "state": order.shippingAddress.state || "Delhi",
            "country": "India",
            "phone": cleanPhone,
            "alt_phone": cleanPhone, // Mandatory
            "email": "bafnatoys@gmail.com",

            // Billing Info (Mandatory in V3)
            "is_billing_same_as_shipping": "yes", 
            "billing_name": order.shippingAddress.fullName,
            "billing_add": order.shippingAddress.street,
            "billing_pin": cleanPincode,
            "billing_phone": cleanPhone,
            "billing_alt_phone": cleanPhone,
            
            "products": cleanProducts,
            
            "shipment_length": "10",
            "shipment_width": "10",
            "shipment_height": "10",
            "weight": "0.5",
            
            // Mandatory Charges & Discounts
            "shipping_charges": "0",
            "giftwrap_charges": "0",
            "transaction_charges": "0",
            "total_discount": "0",
            "first_attemp_discount": "0",
            "cod_charges": "0",
            "advance_amount": String(order.advancePaid || 0),
            "cod_amount": isCod ? finalTotalStr : "0", 
            
            "payment_mode": isCod ? "COD" : "Prepaid",
            "reseller_name": "",
            "eway_bill_number": "",
            "gst_number": "",
            "return_address_id": warehouseId
          }
        ],
        "pickup_address_id": warehouseId,
        "access_token": process.env.ITHINK_ACCESS_TOKEN,
        "secret_key": process.env.ITHINK_SECRET_KEY,
        "logistics": "Delhivery", 
        "s_type": "surface",
        "order_type": "forward"
      }
    };

    console.log("📦 FINAL PAYLOAD:", JSON.stringify(payload, null, 2));

    // ---------- 4. API CALL ----------
    const response = await axios.post(
      "https://my.ithinklogistics.com/api_v3/order/add.json",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("📩 iThink Response:", JSON.stringify(response.data, null, 2));

    const resultData = response.data;

    if (resultData && resultData.status === "success") {
      // iThink V3 data is keyed by string index "1", "2" etc.
      const orderResult = resultData.data["1"]; 
      
      if (orderResult.status.toLowerCase() === "success") {
        order.isShipped = true;
        order.trackingId = orderResult.waybill;
        order.courierName = orderResult.logistic_name || "Delhivery";
        order.status = "shipped";
        await order.save();

        console.log("✅ Success! Waybill Generated:", orderResult.waybill);
        return res.status(200).json({ success: true, waybill: orderResult.waybill });
      } else {
        console.log("❌ Remark Error:", orderResult.remark);
        return res.status(400).json({ success: false, error: orderResult.remark });
      }
    }

    return res.status(400).json({ 
      success: false, 
      error: resultData.html_message || "Booking Failed" 
    });

  } catch (error) {
    console.error("🔥 Global Error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { createShippingOrder };