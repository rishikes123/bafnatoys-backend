const mongoose = require('mongoose');

const trustSettingsSchema = new mongoose.Schema({
  retailerCount: { type: String, default: '49,000+' },
  factoryImage: { type: String, default: '' },
  
  // Legacy fields (Pehle wale fields safety/fallback ke liye rakhe hain)
  manufacturingUnit: { type: String, default: '' },
  packingDispatch: { type: String, default: '' },
  warehouseStorage: { type: String, default: '' },
  
  // ✅ NAYA: Dynamic Factory Visuals Array
  factoryVisuals: [{
    image: { type: String, default: '' },
    label: { type: String, default: '' }
  }],

  customerReviews: [{
    image: { type: String, default: '' },
    reviewText: { type: String, default: '' },
    reviewerName: { type: String, default: '' },
    rating: { type: Number, default: 5 }
  }],

  // Social Media Links
  youtubeLink: { type: String, default: '' },
  instagramLink: { type: String, default: '' },
  facebookLink: { type: String, default: '' },
  linkedinLink: { type: String, default: '' },

  // Logos ke liye Image Fields
  makeInIndiaLogo: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('TrustSettings', trustSettingsSchema);