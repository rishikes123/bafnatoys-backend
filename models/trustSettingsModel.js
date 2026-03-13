const mongoose = require('mongoose');

const trustSettingsSchema = new mongoose.Schema({
  badge1: { type: String, default: '' },
  badge2: { type: String, default: '' },
  badge3: { type: String, default: '' },
  badge4: { type: String, default: '' },
  factoryImage: { type: String, default: '' },
  
  manufacturingUnit: { type: String, default: '' },
  packingDispatch: { type: String, default: '' },
  warehouseStorage: { type: String, default: '' },
  starterBoxImage: { type: String, default: '' },
  
  // ✅ NAYA FIELD: Factory Slider ke multiple images ke liye
  factorySliderImages: { type: [String], default: [] }, 
}, { timestamps: true });

module.exports = mongoose.model('TrustSettings', trustSettingsSchema);