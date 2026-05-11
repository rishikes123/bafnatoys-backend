const express = require("express");
const router = express.Router();
const WhatsAppSettings = require("../models/whatsappSettingsModel");

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
        const msgBody = msg.text?.body?.toLowerCase() || "";

        console.log(`📩 New message from ${from}: ${msgBody}`);

        // --- BOT LOGIC START ---
        let replyText = "";

        if (msgBody.includes("hi") || msgBody.includes("hello") || msgBody.includes("start")) {
          replyText = "Welcome to Bafna Toys! 🧸\nHow can we help you today?\n1. Order Status\n2. Download Catalog\n3. Talk to Agent";
        } else if (msgBody.includes("catalog")) {
          replyText = "You can view our latest catalog here: https://bafnatoys.com/download-catalogue/pdf";
        } else {
          replyText = "Thank you for messaging Bafna Toys. Our team will get back to you soon!";
        }
        // --- BOT LOGIC END ---

        // Send Auto-Reply via Meta API
        if (replyText && ACCESS_TOKEN && PHONE_NUMBER_ID) {
          try {
            await axios.post(
              `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
              {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
                text: { body: replyText },
              },
              {
                headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
              }
            );
          } catch (apiErr) {
            console.error("❌ WhatsApp API Error:", apiErr.response?.data || apiErr.message);
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
