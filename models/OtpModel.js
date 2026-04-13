const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  otp: { type: String, required: true },
  attempts: { type: Number, default: 0 },   // wrong attempt counter
  createdAt: { type: Date, default: Date.now, expires: 600 }, // auto-delete after 10 minutes
});

module.exports = mongoose.model("Otp", otpSchema);
