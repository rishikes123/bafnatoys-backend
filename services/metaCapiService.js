const axios = require("axios");
const crypto = require("crypto");

// Hash user data for Meta CAPI (must be SHA256)
const hashData = (data) => {
  if (!data) return undefined;
  const cleanData = data.toString().trim().toLowerCase();
  return crypto.createHash("sha256").update(cleanData).digest("hex");
};

/**
 * Send Purchase event directly to Meta Graph API
 * @param {Object} order - Order object containing total, items, and orderNumber
 * @param {Object} customer - Customer object with email, phone, name, city, state, zip
 * @param {Object} metaSetting - Contains pixelId and accessToken
 */
const sendPurchaseEvent = async (order, customer, metaSetting) => {
  try {
    const { pixelId, accessToken, enabled, events } = metaSetting || {};
    
    // Only proceed if CAPI is enabled, token exists, and purchase tracking is enabled
    if (!enabled || !pixelId || !accessToken || !events?.purchase) return;

    // Build the user_data payload
    const userData = {};
    
    if (customer?.email) userData.em = [hashData(customer.email)];
    
    // Format phone: remove non-digits
    const phoneDigits = customer?.otpMobile || customer?.whatsapp || "";
    const cleanPhone = phoneDigits.replace(/\D/g, "");
    if (cleanPhone) {
      // Ensure phone has country code (e.g., 91 for India)
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      userData.ph = [hashData(formattedPhone)];
    }

    if (customer?.fullName || customer?.ownerName || customer?.shopName) {
      const nameParts = (customer.fullName || customer.ownerName || customer.shopName).trim().split(" ");
      userData.fn = [hashData(nameParts[0])];
      if (nameParts.length > 1) {
        userData.ln = [hashData(nameParts[nameParts.length - 1])];
      }
    }

    if (customer?.city) userData.ct = [hashData(customer.city)];
    if (customer?.state) userData.st = [hashData(customer.state)];
    if (customer?.zip) userData.zp = [hashData(customer.zip)];

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_id: order.orderNumber, // Crucial for deduplication with browser pixel
          user_data: userData,
          custom_data: {
            currency: "INR",
            value: order.total,
            content_ids: order.items.map(i => i.sku || i.productId?.toString() || ""),
            content_type: "product"
          }
        }
      ]
    };

    const url = `https://graph.facebook.com/v19.0/${pixelId}/events`;
    
    await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    console.log(`✅ [Meta CAPI] Purchase event sent for order ${order.orderNumber}`);
  } catch (error) {
    console.error("❌ [Meta CAPI] Failed to send Purchase event:", error.response?.data || error.message);
  }
};

module.exports = {
  sendPurchaseEvent
};
