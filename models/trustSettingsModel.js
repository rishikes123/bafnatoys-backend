const mongoose = require('mongoose');

const trustSettingsSchema = new mongoose.Schema({
  retailerCount: { type: String, default: '49,000+' },
  
  // Single Images with IDs
  factoryImage: { type: String, default: '' },
  factoryImageId: { type: String, default: '' },
  makeInIndiaLogo: { type: String, default: '' },
  makeInIndiaLogoId: { type: String, default: '' },
  
  // Legacy fields (Safety fallback)
  manufacturingUnit: { type: String, default: '' },
  packingDispatch: { type: String, default: '' },
  warehouseStorage: { type: String, default: '' },
  
  // Dynamic Factory Visuals Array
  factoryVisuals: [{
    image: { type: String, default: '' },
    imageId: { type: String, default: '' },
    label: { type: String, default: '' }
  }],

  // Customer Reviews Array
  customerReviews: [{
    image: { type: String, default: '' },
    imageId: { type: String, default: '' },
    reviewText: { type: String, default: '' },
    reviewerName: { type: String, default: '' },
    rating: { type: Number, default: 5 }
  }],

  // Social Media Links
  youtubeLink: { type: String, default: '' },
  instagramLink: { type: String, default: '' },
  facebookLink: { type: String, default: '' },
  linkedinLink: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('TrustSettings', trustSettingsSchema);