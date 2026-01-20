const axios = require('axios');
const Order = require('../models/orderModel');

const createShippingOrder = async (req, res) => {
  try {
    console.log("🚀 Shipping Process Started...");
    const { orderId } = req.body;
    
    // Order fetch karein aur customer ki details populate karein
    const order = await Order.findById(orderId).populate('customerId');
    if (!order) {
        return res.status(404).json({ message: "Order not found" });
    }

    // Data Cleaning
    const cleanPincode = String(order.shippingAddress.pincode).trim();
    const cleanPhone = String(order.shippingAddress.phone).replace(/\D/g, '').slice(-10);
    
    // iThink ko specific date format chahiye hota hai (YYYY-MM-DD)
    const orderDate = new Date().toISOString().split('T')[0];

    const payload = {
      "data": [
        {
          "shipment_height": 10,
          "shipment_width": 10,
          "shipment_length": 10,
          "shipment_weight": 0.5,
          
          // ✅ CRITICAL: Warehouse ID ko 'pickup_address_id' field mein bhi bhejna zaroori hai
          "pickup_address_id": process.env.ITHINK_WAREHOUSE_ID, 
          "login_customer_address_id": 0, 
          
          // Customer Details
          "consignee_name": order.shippingAddress.fullName || "Customer",
          "consignee_mobile": cleanPhone,
          "consignee_email": "bafnatoys@gmail.com",
          "consignee_address": order.shippingAddress.street || "Address Missing",
          "consignee_pincode": cleanPincode,
          "consignee_city": order.shippingAddress.city,
          "consignee_state": order.shippingAddress.state,
          
          // Order Details
          "order_type": order.paymentMode === "COD" ? "COD" : "Prepaid",
          "order_id": order.orderNumber,
          "order_date": orderDate,
          "collectable_amount": order.paymentMode === "COD" ? Math.round(order.remainingAmount) : 0,
          
          "product_name": "Toys Order",
          "product_quantity": order.items.length || 1,
          "product_price": Math.round(order.total),
          
          // Pickup/Return Info
          "pickup_pincode": "641007",
          "return_name": "Bafnatoys",
          "return_phone": "9043347300",
          "return_address": "1-12, Sundapalayam Rd, Coimbatore",
          "return_pincode": "641007",
        }
      ],
      "access_token": process.env.ITHINK_ACCESS_TOKEN,
      "secret_key": process.env.ITHINK_SECRET_KEY,
      "warehouse_id": process.env.ITHINK_WAREHOUSE_ID 
    };

    console.log("📦 Sending Payload to iThink...");

    const response = await axios.post("https://my.ithinklogistics.com/api/order/add.json", payload);

    console.log("📩 iThink Full Response Raw:", JSON.stringify(response.data, null, 2));

    // iThink Response check (Array ya Object)
    let result = Array.isArray(response.data) ? response.data[0] : response.data;
    
    // Agar response ke andar 'data' field array mein hai
    if (response.data.data && Array.isArray(response.data.data)) {
        result = response.data.data[0];
    }

    if (result && (result.status === "success" || result.status === "1" || result.waybill)) {
        order.isShipped = true;
        order.trackingId = result.waybill || (result.data ? result.data.waybill : "Pending");
        order.courierName = "iThinkLogistics";
        order.status = "shipped";
        await order.save();

        console.log("✅ Shipping Booked! Waybill:", order.trackingId);
        return res.status(200).json({ success: true, waybill: order.trackingId });
    } else {
        const errorMsg = result ? (result.msg || result.message) : "Unknown Error";
        console.log("❌ iThink Booking Failed:", errorMsg);
        return res.status(400).json({ 
            success: false, 
            message: "Booking Failed: " + errorMsg,
            debug: result 
        });
    }

  } catch (error) {
    console.error("🔥 Controller Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { createShippingOrder };