const mongoose = require("mongoose");

const agentSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Support" },
    phone: { type: String, default: "" }, // digits only e.g. 917550350036
    title: { type: String, default: "" }, // e.g. "Customer Executive"
    avatar: { type: String, default: "" }, // optional image URL
    enabled: { type: Boolean, default: true },
    message: { type: String, default: "" }, // custom prefilled msg (fallback to defaultMessage)
  },
  { _id: false }
);

const whatsappSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    phone: { type: String, default: "" }, // legacy
    defaultMessage: { type: String, default: "Hi! I need help." },

    // UI
    position: { type: String, enum: ["right", "left"], default: "right" },
    offsetX: { type: Number, default: 18 },
    offsetY: { type: Number, default: 18 },
    showGreeting: { type: Boolean, default: true },
    greetingText: { type: String, default: "Chat with us on WhatsApp" },
    autoOpenDelay: { type: Number, default: 0 },

    // visibility
    showOnMobile: { type: Boolean, default: true },
    showOnDesktop: { type: Boolean, default: true },
    showOnPaths: { type: [String], default: [] },
    hideOnPaths: { type: [String], default: [] },

    // schedule
    enableSchedule: { type: Boolean, default: false },
    startHour: { type: Number, default: 9 },
    endHour: { type: Number, default: 18 },
    days: { type: [Number], default: [1, 2, 3, 4, 5, 6] },

    // NEW: multiple agents
    agents: { type: [agentSchema], default: [] },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.WhatsAppSettings ||
  mongoose.model("WhatsAppSettings", whatsappSettingsSchema);
