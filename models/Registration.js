const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true },
    address: { type: String, required: true },
    otpMobile: { type: String, required: true, unique: true },
    whatsapp: { type: String, required: false },
    password: { type: String }, 
    
    // ✅ CHANGE: 'default: ""' add kiya
    visitingCardUrl: { 
      type: String, 
      required: false, 
      default: ""  // <-- Ye line add karein
    }, 

    isApproved: { type: Boolean, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Registration", RegistrationSchema);