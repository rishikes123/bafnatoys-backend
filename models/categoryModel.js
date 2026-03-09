const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    // 👇 Slug URL ke liye (Routes me use ho raha tha)
    slug: {
      type: String,
      trim: true,
    },
    // 👇 Custom Link / Page Link (Yeh add karna zaroori tha!)
    link: {
      type: String,
      trim: true,
      default: "", // Agar koi link nahi daalta toh khali rahega
    },
    // 👇 Cloudinary Image URL
    image: {
      type: String,
      required: true, // Image zaroori hai
    },
    // 👇 Cloudinary Public ID (Delete karne ke liye)
    imageId: {
      type: String,
      required: true,
    },
    order: {
      type: Number,
      default: 0, 
    },
  },
  { timestamps: true }
);

const Category = mongoose.model("Category", categorySchema);
module.exports = Category;