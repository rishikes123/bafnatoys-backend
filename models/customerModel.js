// backend/models/customerModel.js
const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  otpMobile: { type: String, required: true },
  firmName: { type: String, default: "" },
  shopName: { type: String, default: "" },
  state: { type: String, default: "" },
  city: { type: String, default: "" },
  zip: { type: String, default: "" },
  whatsapp: { type: String, default: "" },
  visitingCardUrl: { type: String, default: "" },
  status: {
    type: String,
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending",
  },
}, {
  timestamps: true,
});

module.exports =
  mongoose.models.Customer ||
  mongoose.model("Customer", customerSchema);
