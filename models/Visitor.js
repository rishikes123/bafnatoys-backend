const mongoose = require("mongoose");

const visitorSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    count: { type: Number, default: 0 },
    ips: [{ type: String }],

    // Traffic Sources
    sources: {
      google: { type: Number, default: 0 },
      instagram: { type: Number, default: 0 },
      facebook: { type: Number, default: 0 },
      whatsapp: { type: Number, default: 0 },
      direct: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },

    // ✅ State Tracking (India)
    states: { type: Map, of: Number, default: {} },

    // ✅ NEW: Device Tracking
    devices: {
      mobile: { type: Number, default: 0 },
      desktop: { type: Number, default: 0 },
      tablet: { type: Number, default: 0 },
    },

    // ✅ NEW: OS Tracking
    os: {
      android: { type: Number, default: 0 },
      ios: { type: Number, default: 0 },
      windows: { type: Number, default: 0 },
      mac: { type: Number, default: 0 },
      linux: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },

    // ✅ NEW: Browser Tracking
    browsers: {
      chrome: { type: Number, default: 0 },
      safari: { type: Number, default: 0 },
      firefox: { type: Number, default: 0 },
      edge: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },

    // ✅ NEW: Page Views (Kaunsa product sabse zyada dekha gaya)
    pageViews: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Visitor", visitorSchema);