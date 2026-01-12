const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true },
    address: { type: String, required: true },
    otpMobile: { type: String, required: true, unique: true },
    
    whatsapp: { type: String, required: false }, // Optional

    password: { type: String },

    // ✅ YAHAN 'default: ""' HONA ZAROORI HAI
    visitingCardUrl: { type: String, required: false, default: "" }, 

    isApproved: { type: Boolean, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Registration", RegistrationSchema);