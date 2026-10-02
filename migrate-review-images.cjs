require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
(async () => {
 await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
 const collection=mongoose.connection.collection('trustsettings');
 const settings=await collection.findOne({});
 const scenes=settings.productShowcases || [];
 if (!scenes.length) { console.log('Entries already moved.'); return; }
 const entries=scenes.map(s=>({image:s.image,imageId:s.imageId,reviewText:s.description,reviewerName:s.title,entryType:'illustration',generated:s.generated!==false}));
 const result=await collection.updateOne({_id:settings._id,updatedAt:settings.updatedAt},{$push:{customerReviews:{$each:entries}},$set:{productShowcases:[],updatedAt:new Date()}});
 if (!result.modifiedCount) throw new Error('Settings changed; migration not applied.');
 console.log('Moved',entries.length,'images into Customer Reviews.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
