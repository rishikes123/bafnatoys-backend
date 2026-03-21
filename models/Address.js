const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    
    // Billing Details (Matching new frontend fields)
    shopName: { type: String, required: true }, 
    fullName: { type: String, required: true }, // Contact Person
    phone: { type: String, required: true },
    street: { type: String, required: true },   // Changed from line1
    area: { type: String },                     // Changed from line2
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },  // Changed from zip
    type: { type: String, default: "Work" },    // Changed from label
    isDefault: { type: Boolean, default: false },
    gstNumber: { type: String },                // Optional GST field

    // Different Shipping Address Details
    isDifferentShipping: { type: Boolean, default: false },
    shippingStreet: { type: String },
    shippingArea: { type: String },
    shippingCity: { type: String },
    shippingState: { type: String },
    shippingPincode: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Address", addressSchema);