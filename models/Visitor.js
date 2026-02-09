const mongoose = require("mongoose");

const visitorSchema = new mongoose.Schema({
  // 📅 Date (Unique for every day)
  date: { type: String, required: true, unique: true }, // Format: "YYYY-MM-DD"
  
  // 🔢 Total Count
  count: { type: Number, default: 0 },
  
  // 🕵️ Unique IPs (Duplicate count rokne ke liye)
  ips: [{ type: String }],

  // ✅ Traffic Sources: Pata chalega user kahan se aaya
  sources: {
    google: { type: Number, default: 0 },    // Search se
    instagram: { type: Number, default: 0 }, // Instagram Bio/Story se
    facebook: { type: Number, default: 0 },  // FB Ads/Post se
    whatsapp: { type: Number, default: 0 },  // WhatsApp Link se
    direct: { type: Number, default: 0 },    // Seedha website type kiya
    other: { type: Number, default: 0 }      // Koi aur rasta
  },

  // 🌍 NEW: Country Tracking (Map use karenge taaki koi bhi desh add ho sake)
  countries: {
    type: Map,
    of: Number,
    default: {}
  }
});

module.exports = mongoose.model("Visitor", visitorSchema);