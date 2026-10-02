require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const fs = require('fs');
const imagekit = require('./config/imagekit');
const TrustSettings = require('./models/trustSettingsModel');
const entries = [
 ['bafna-display.png', 'Bafna Jet Blasters on display', 'Shop display inspiration featuring our Jet Blasters pullback cars.'],
 ['bafna-packing.png', 'Bafna Toys, packed together', 'A packing illustration featuring our branded Jet Blasters packs.'],
 ['bafna-dino.png', 'Dino World dinosaur sets', 'Our colourful 10-piece dinosaur sets, pictured in a shop display illustration.'],
 ['bafna-bird.png', 'Bafna Wind-Up Bird toys', 'Our wind-up bird toys with their original yellow Bafna packaging, in a packing illustration.']
];
(async () => {
 await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
 const current = await TrustSettings.findOne().lean();
 if (current?.productShowcases?.length) { console.log('Showcases already saved; preserved existing entries.'); return; }
 const slides = [];
 for (const [file, title, description] of entries) {
   const uploaded = await imagekit.upload({ file: fs.readFileSync('../frontend/public/images/retailer-scenes/' + file), fileName: file, folder: '/bafnatoys/showcases' });
   slides.push({ image: uploaded.url, imageId: uploaded.fileId, title, description, generated: true });
 }
 const result = await TrustSettings.updateOne({ _id: current._id, $or: [{ productShowcases: { $exists: false } }, { productShowcases: { $size: 0 } }] }, { $set: { productShowcases: slides } });
 console.log('Product showcases saved:', result.modifiedCount, 'document,', slides.length, 'slides.');
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
