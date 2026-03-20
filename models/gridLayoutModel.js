const mongoose = require("mongoose");

const gridLayoutSchema = new mongoose.Schema(
  {
    pcColumns: { type: Number, default: 5 },
    mobileColumns: { type: Number, default: 2 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GridLayout || mongoose.model("GridLayout", gridLayoutSchema);