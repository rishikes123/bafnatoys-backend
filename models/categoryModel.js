const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
    },
    link: {
      type: String,
      trim: true,
      default: "",
    },
    // ImageKit Image URL
    image: {
      type: String,
      required: true,
    },
    // ImageKit Public ID (Delete/Update karne ke liye)
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