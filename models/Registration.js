const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema({
  firmName:        { type: String, required: true },
  shopName:        { type: String, required: true },
  state:           { type: String, required: true },
  city:            { type: String, required: true },
  zip:             { type: String, required: true },
  otpMobile:       { type: String, required: true, unique: true },
  whatsapp:        { type: String, required: true },
  visitingCardUrl: { type: String, default: '' },
  isApproved:      { type: Boolean, default: null }  // null = pending
}, { timestamps: true });

module.exports = mongoose.model('Registration', RegistrationSchema);
