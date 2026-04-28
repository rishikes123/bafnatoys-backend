const mongoose = require("mongoose");

const delhiveryLedgerSchema = new mongoose.Schema({
  waybill:      { type: String, required: true, unique: true, index: true },
  pickupDate:   Date,
  zone:         String,
  status:       String,
  grossAmount:  Number,   // DEL FREIGHT (freight + fuel surcharge + handling, before GST)
  totalAmount:  Number,   // grossAmount + GST
  codAmount:    Number,   // COD collection amount
  igst:         Number,
  cgst:         Number,
  sgst:         Number,
  uploadedAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model("DelhiveryLedger", delhiveryLedgerSchema);
