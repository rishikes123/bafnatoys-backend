const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    adminName: { type: String, required: true },
    actionType: { 
      type: String, 
      enum: ['Excel Export', 'Invoice Download', 'Bulk Excel Export'], 
      required: true 
    },
    orderNumber: { type: String, default: "Bulk/All" },
    details: { type: String } 
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);