const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema({
  // Ye field zaroori hai taaki backend pehchan sake ki ye "cod" ki setting hai
  key: { 
    type: String, 
    required: true, 
    unique: true 
  },
  
  // Iske andar value save hogi (e.g. { advanceAmount: 500 })
  data: { 
    type: Object, 
    default: {} 
  }
}, { timestamps: true });

module.exports = mongoose.model("Setting", settingSchema);