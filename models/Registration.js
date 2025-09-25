// models/Registration.js
const mongoose = require("mongoose");

const RegistrationSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      required: true,
      trim: true,
    },
    otpMobile: {
      type: String,
      required: true,
      unique: true,
    },
    whatsapp: {
      type: String,
      default: "",
      trim: true,
    },
    password: {
      type: String,
      default: "",
    },
    visitingCardUrl: {
      type: String,
      default: "",
    },
    isApproved: {
      type: Boolean,
      default: null, // null = pending
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Registration", RegistrationSchema);
