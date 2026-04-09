const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true,
  },
  // 👇 ImageKit Delete ke liye ID zaroori hai
  imageId: {
    type: String,
    required: true,
  },
  link: {
    type: String, 
    default: '',  
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