const express = require("express");
const router = express.Router();
const axios = require("axios");
const WhatsAppSettings = require("../models/whatsappSettingsModel");

const WA_VER = process.env.WA_API_VERSION || "v20.0";

const DEFAULTS = {
  enabled: true,
  phone: "",
  defaultMessage: "Hi Bafna Toys, I want to explore your toys! 🧸",
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

/* ====================================================================
   🔥 WHATSAPP BUSINESS API WEBHOOK LOGIC
   ==================================================================== */

const Order = require("../models/orderModel");
const Product = require("../models/Product");
const Category = require("../models/categoryModel");

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
        
        let msgBody = "";
        if (msg.type === "text") {
          msgBody = msg.text?.body?.trim().toLowerCase() || "";
        } else if (msg.type === "interactive") {
          // Handle both button replies and list selections
          msgBody = msg.interactive?.button_reply?.title?.trim().toLowerCase() || 
                    msg.interactive?.list_reply?.title?.trim().toLowerCase() || "";
        }

        if (!msgBody) return res.sendStatus(200);

        console.log(`📩 Message from ${from}: ${msgBody}`);

        let replyText = "";
        let replyImage = "";
        let replyDoc = "";

        // --- 1. WELCOME & MAIN MENU LOGIC (Highest Priority) ---
        if (msgBody.includes("hi") || msgBody.includes("hello") || msgBody.includes("start")) {
          const welcomeBody = `*Namaste! Welcome to Bafna Toys* 🧸✨\n\n` +
                              `India's leading *B2B Toy Manufacturer*. 🏭🇮🇳\n\n` +
                              `✅ Factory Price | BIS Certified\n` +
                              `✅ 4,900+ Trusted Retailers\n\n` +
                              `Please select an option from the *Main Menu* below to get started:`;

          if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
            try {
              const sections = [{
                title: "Main Menu",
                rows: [
                  { id: "order", title: "📦 Order Status", description: "Track your shipment" },
                  { id: "catalog", title: "📚 Get Catalog", description: "Latest wholesale price list" },
                  { id: "agent", title: "👤 Talk to Agent", description: "Chat with support" },
                  { id: "instagram", title: "📸 Instagram", description: "Follow us for updates" }
                ]
              }];

              await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: from,
                type: "interactive",
                interactive: {
                  type: "list",
                  header: { type: "text", text: "Bafna Toys 🧸" },
                  body: { text: welcomeBody },
                  footer: { text: "Click below to see options 👇" },
                  action: {
                    button: "Main Menu",
                    sections
                  }
                }
              }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
              return res.sendStatus(200); 
            } catch (err) {
              console.error("❌ Menu Error:", err.response?.data || err.message);
              replyText = welcomeBody; 
            }
          } else {
            replyText = welcomeBody;
          }
        }

        // --- 2. CATEGORY LIST LOGIC ---
        else if (msgBody.includes("categories") || msgBody.includes("📂")) {
          const cats = await Category.find().sort({ order: 1 }).limit(10).lean();
          
          if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
            const sections = [{
              title: "Our Toy Categories",
              rows: [
                ...cats.map(c => ({
                  id: `cat_${c._id}`,
                  title: c.name.substring(0, 24),
                  description: `View ${c.name} on website`
                })),
                { id: "agent_row", title: "👤 Talk to Agent", description: "Chat with our support team" }
              ]
            }];

            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: from,
              type: "interactive",
              interactive: {
                type: "list",
                header: { type: "text", text: "Browse Categories 📂" },
                body: { text: "Select a category to view products on our website." },
                footer: { text: "Bafna Toys - Factory Direct" },
                action: {
                  button: "View All",
                  sections
                }
              }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
            return res.sendStatus(200);
          }
        }

        // --- B. CATEGORY SELECTION HANDLER ---
        if (msgBody.startsWith("cat_") || (msg.type === "interactive" && msg.interactive?.list_reply?.id?.startsWith("cat_"))) {
          const catId = msg.interactive?.list_reply?.id?.replace("cat_", "");
          const category = await Category.findById(catId);
          if (category) {
            replyText = `📂 *${category.name}*\n\nExplore all products in this category here:\nhttps://bafnatoys.com/category/${category.slug || category._id}`;
          }
        }

        // --- C. ORDER STATUS LOGIC ---
        else if (msgBody.startsWith("odr") || msgBody.startsWith("ret") || (msgBody.length >= 7 && !isNaN(msgBody.substring(3)))) {
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

        // --- D. CATALOG LOGIC ---
        else if (msgBody.includes("catalog") || msgBody.includes("price list")) {
          // Send acknowledgement first because PDF generation/download might take time
          if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              type: "text",
              text: { body: "Generating your latest wholesale catalog PDF... Please wait a moment ⏳" }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
          }
          replyDoc = "https://api.bafnatoys.com/api/products/download-catalogue/pdf"; 
          replyText = "Here is your catalog! 📚 Feel free to ask if you have any questions.";
        }

        // --- E. AGENT / HELP LOGIC ---
        else if (msgBody.includes("agent") || msgBody.includes("help") || msgBody.includes("talk")) {
          replyText = "Our support team is here to help! 👤\n\n" +
                      "📞 *Call/WhatsApp:* +91 9080114528\n" +
                      "📧 *Email:* bafnatoysphotos@gmail.com\n\n" +
                      "An agent will check this chat shortly and get back to you. Thank you for your patience! 🙏";
        }

        // --- 7. INSTAGRAM LOGIC ---
        else if (msgBody.includes("instagram") || msgBody.includes("📸")) {
          replyText = "Follow us on Instagram for latest toy updates and factory videos! 📸✨\n\n" +
                      "🔗 *Instagram Link:* https://www.instagram.com/bafna_toys?igsh=MXRmNWs3dmZyYTJmbw==\n\n" +
                      "Don't forget to tag us in your stories! 🧸";
        }

        // --- 8. PRODUCT SEARCH LOGIC (Last Resort) ---
        else if (msgBody.length > 2 && !["hi","hello","start","help","agent","talk"].some(w => msgBody.includes(w))) {
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
                replyImage = p.images[0]; 
              }
            }
          } else {
            replyText = "I'm not sure about that. Try searching for a toy name (like 'Car' or 'Doll') or send an Order ID.";
          }
        }

        // --- G. SENDING THE FINAL RESPONSE ---
        if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
          if (replyDoc) {
            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              type: "document",
              document: { link: replyDoc, filename: "Bafna_Toys_Catalog.pdf" }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
          }
          if (replyImage) {
            await axios.post(`https://graph.facebook.com/${WA_VER}/${PHONE_NUMBER_ID}/messages`, {
              messaging_product: "whatsapp",
              to: from,
              type: "image",
              image: { link: replyImage }
            }, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
          }
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

/* ====================================================================
   🧪 TEST ENDPOINT — WhatsApp API direct test (admin only)
   POST /api/whatsapp/test-send
   Body: { to: "919876543210", templateName: "hello_world" }
   ==================================================================== */
const { sendWhatsAppTemplate } = require("../services/whatsappService");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");
// Order already required above at line 90

router.post("/test-send", adminProtect, isAdmin, async (req, res) => {
  const { to, templateName } = req.body;
  if (!to) return res.status(400).json({ error: "to (phone number) required. Format: 919XXXXXXXXX" });

  const template = templateName || "hello_world";
  try {
    const result = await sendWhatsAppTemplate({
      to,
      templateName: template,
      languageCode: "en_US",
      components: [],
    });
    res.json({ success: true, template, to, result });
  } catch (err) {
    const detail = err?.response?.data || err.message;
    res.json({ success: false, template, to, error: detail });
  }
});

// GET /api/whatsapp/wa-errors — last 10 orders ka WA error status
router.get("/wa-errors", adminProtect, isAdmin, async (req, res) => {
  try {
    const orders = await Order.find({ "wa.lastError": { $ne: "" } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("orderNumber wa createdAt updatedAt")
      .lean();
    res.json({ count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
