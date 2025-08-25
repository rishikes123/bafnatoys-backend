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
  days: [1, 2, 3, 4, 5, 6], // Mon–Sat
  agents: [],
};

/* ---------------- GET ---------------- */
router.get("/", async (_req, res) => {
  try {
    let doc = await WhatsAppSettings.findOne({});
    if (!doc) doc = await WhatsAppSettings.create(DEFAULTS);

    // 🔄 Backward compatibility: seed a default agent if phone exists but agents list is empty
    if ((!doc.agents || doc.agents.length === 0) && doc.phone) {
      doc.agents = [
        {
          name: "Support",
          phone: (doc.phone || "").replace(/\D/g, ""),
          title: "Customer Support",
          avatar: "",
          enabled: true,
          message: "",
        },
      ];
      await doc.save();
    }

    res.json(doc);
  } catch (e) {
    console.error("WhatsAppSettings GET error:", e);
    res.status(500).json({ message: e.message || "Server error" });
  }
});

/* ---------------- PUT ---------------- */
router.put("/", async (req, res) => {
  try {
    const payload = req.body || {};

    // 🔒 Normalize phone numbers + agent cleanup
    if (Array.isArray(payload.agents)) {
      payload.agents = payload.agents
        .map((a) => ({
          ...a,
          phone: String(a.phone || "").replace(/\D/g, ""), // only digits
          enabled: a.enabled !== false, // force boolean
        }))
        .filter((a) => a.phone); // keep only valid numbers
    }

    const doc = await WhatsAppSettings.findOneAndUpdate({}, payload, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    res.json({ message: "Saved", settings: doc });
  } catch (e) {
    console.error("WhatsAppSettings PUT error:", e);
    res.status(500).json({ message: e.message || "Server error" });
  }
});

module.exports = router;
