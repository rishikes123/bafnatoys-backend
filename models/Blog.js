const mongoose = require("mongoose");

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    content: { type: String, required: true }, // Can contain HTML
    coverImage: { type: String }, // ImageKit URL
    excerpt: { type: String }, // Short description for SEO / cards
    author: { type: String, default: "Bafna Toys" },
    tags: [{ type: String }],
    published: { type: Boolean, default: true },
    metaTitle: { type: String },
    metaDescription: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Blog", blogSchema);
