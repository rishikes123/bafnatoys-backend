const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true },
    otpMobile: { type: String, required: true, unique: true }, // normalized 10-digit
    whatsapp: { type: String, required: true }, // ✅ required
    password: { type: String }, // optional (hash in production)
    visitingCardUrl: { type: String, required: true }, // ✅ required now
    isApproved: { type: Boolean, default: null },   // null = pending, true = approved, false = rejected
  },
  { timestamps: true }
);

module.exports = mongoose.model("Registration", RegistrationSchema);
