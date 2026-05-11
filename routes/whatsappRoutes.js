const express = require("express");
const router = express.Router();
const axios = require("axios");
const WhatsAppSettings = require("../models/whatsappSettingsModel");

const WA_VER = process.env.WA_API_VERSION || "v20.0";

const DEFAULTS = {
  enabled: true,
  phone: "",
  defaultMessage: "Hi! I need help.",
  position: "right",
  offsetX: 18,
  offsetY: 18,
  showGreeting: true,
  greetingText: "Chat with us on WhatsApp",
  autoOpenDelay: 0,
  showOnMobile: true,
  showOnDesktop: true,
  showOnPaths: [],
  hideOnPaths: [],
  enableSchedule: false,
  startHour: 9,
  endHour: 18,
  days: [1, 2, 3, 4, 5, 6],
  agents: [],
};

// GET Settings
router.get("/", async (_req, res) => {
  try {
    let doc = await WhatsAppSettings.findOne({});
    if (!doc) doc = await WhatsAppSettings.create(DEFAULTS);

    // Back-compat: if no agents but legacy phone exists, seed one agent
    if ((!doc.agents || doc.agents.length === 0) && doc.phone) {
      doc.agents = [
        {
          name: "Support",
          phone: (doc.phone || "").replace(/\D/g, ""),
          title: "",
          avatar: "",
          enabled: true,
          message: "",
        },
      ];
      await doc.save();
    }

    res.json(doc);
  } catch (e) {
    res.status(500).json({ message: e.message || "Server error" });
  }
});

// PUT Settings
router.put("/", async (req, res) => {
  try {
    const payload = req.body || {};

    if (Array.isArray(payload.agents)) {
      payload.agents = payload.agents
        .map((a) => ({
          ...a,
          phone: String(a.phone || "").replace(/\D/g, ""),
          enabled: a.enabled !== false,
        }))
        .filter((a) => a.phone); // keep only valid numbers
    }

    const doc = await WhatsAppSettings.findOneAndUpdate({}, payload, {
      new: true,
      upsert: true,
    });

    res.json({ message: "Saved", settings: doc });
  } catch (e) {
    res.status(500).json({ message: e.message || "Server error" });
  }
});

/* ====================================================================
   🔥 WHATSAPP BUSINESS API WEBHOOK LOGIC
   ==================================================================== */

const Order = require("../models/orderModel");
const Product = require("../models/Product");

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "BAFNA_TOYS_BOT_2026";
const ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;

// 1. Webhook Verification (GET)
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WHATSAPP_WEBHOOK_VERIFIED");
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
});

// 2. Webhook Event Handling (POST)
router.post("/webhook", async (req, res) => {
  try {
    const { body } = req;

    if (body.object === "whatsapp_business_account") {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const msg = body.entry[0].changes[0].value.messages[0];
        const from = msg.from; // Customer's number
        const msgBody = msg.text?.body?.trim().toLowerCase() || "";

        if (!msgBody) return res.sendStatus(200);

        console.log(`📩 Message from ${from}: ${msgBody}`);

        let replyText = "";
        let replyImage = "";
        let replyDoc = "";

        // --- 1. ORDER STATUS LOGIC ---
        if (msgBody.startsWith("odr") || msgBody.startsWith("ret") || (msgBody.length >= 7 && !isNaN(msgBody.substring(3)))) {
          const order = await Order.findOne({ 
            $or: [
              { orderNumber: new RegExp(msgBody, 'i') },
              { trackingId: new RegExp(msgBody, 'i') }
            ]
          });

          if (order) {
            replyText = `📦 *Order Status for ${order.orderNumber}*\n\n` +
                        `🔹 Status: *${order.status.toUpperCase()}*\n` +
                        `💰 Total: ₹${order.total}\n` +
                        `🚛 Courier: ${order.courierName || "Not assigned"}\n` +
                        `🆔 Tracking: ${order.trackingId || "N/A"}\n\n` +
                        `View details: https://bafnatoys.com/orders/${order._id}`;
          } else {
            replyText = "❌ Sorry, I couldn't find any order with that ID. Please check and try again.";
          }
        }

        // --- 2. CATALOG LOGIC ---
        else if (msgBody.includes("catalog") || msgBody.includes("price list")) {
          replyText = "Sure! Here is our latest wholesale catalog PDF.";
          replyDoc = "https://bafnatoys.com/download-catalogue/pdf"; // Adjust to your actual PDF link
        }

        // --- 3. PRODUCT SEARCH LOGIC ---
        else if (msgBody.length > 2) {
          const products = await Product.find({
            $or: [
              { name: { $regex: msgBody, $options: "i" } },
              { categoryName: { $regex: msgBody, $options: "i" } }
            ]
          }).limit(3).lean();

          if (products.length > 0) {
            replyText = `🔍 *Search results for "${msgBody}":*\n\n`;
            for (const p of products) {
              replyText += `🧸 *${p.name}*\n💰 Price: ₹${p.price}\n🔗 Link: https://bafnatoys.com/product/${p.slug || p._id}\n\n`;
              if (!replyImage && p.images && p.images.length > 0) {
                replyImage = p.images[0]; // Set the first product image to send
              }
            }
          } else if (msgBody.includes("hi") || msgBody.includes("hello") || msgBody.includes("start")) {
            replyText = "Welcome to Bafna Toys! 🧸\nHow can we help you today?\n\n👉 Send *Order ID* (e.g. ODR1001) for status.\n👉 Send *Product Name* (e.g. Doll) to search.\n👉 Send *Catalog* to get PDF.";
          } else {
            replyText = "I'm not sure about that. Try searching for a toy name (like 'Car' or 'Doll') or send an Order ID.";
          }
        }

        // --- SENDING THE RESPONSE ---
        if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
          // A. Send Document (if catalog)
          if (replyDoc) {
            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              type: "document",
              document: { link: replyDoc, filename: "Bafna_Toys_Catalog.pdf" }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
          }

          // B. Send Image (if product search)
          if (replyImage) {
            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              type: "image",
              image: { link: replyImage }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
          }

          // C. Send Text (Primary reply)
          if (replyText) {
            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              type: "text",
              text: { body: replyText }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
          }
        }
      }
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  } catch (err) {
    console.error("❌ Webhook Error:", err);
    res.sendStatus(500);
  }
});

module.exports = router;
