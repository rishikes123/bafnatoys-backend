const mongoose = require("mongoose");

const customBoxSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true }, // e.g. "Mini 1pc Box"
    length:   { type: Number, required: true },             // cm
    breadth:  { type: Number, required: true },             // cm
    height:   { type: Number, required: true },             // cm
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CustomBox || mongoose.model("CustomBox", customBoxSchema);
