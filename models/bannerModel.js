const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
  },
  link: {
    type: String, // 👈 yahan banner ka redirect link store hoga
    default: '',  // optional hai, agar blank chhoda to koi redirect nahi hoga
  },
  enabled: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Banner', bannerSchema);
