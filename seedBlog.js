require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Blog = require("./models/Blog");
const imagekit = require("./config/imagekit");

const seedBlog = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to Mongo");

    const imagePath = "C:\\Users\\bafna\\.gemini\\antigravity\\brain\\88fc5cae-3340-404b-9f88-1df73952ffaf\\blog_hero_toys_1779275981641.png";
    const imageBuffer = fs.readFileSync(imagePath);

    console.log("Uploading to ImageKit...");
    const uploadResult = await imagekit.upload({
      file: imageBuffer,
      fileName: "blog_hero_toys.png",
      folder: "/bafnatoys_blogs",
    });

    console.log("Uploaded! URL:", uploadResult.url);

    const blogContent = `
      <h2>Why B2B Toy Sourcing is Evolving in India</h2>
      <p>The wholesale toy market in India is experiencing unprecedented growth. Retailers and distributors are constantly looking for the best margins, highest quality, and fastest delivery times.</p>
      <p>At <strong>Bafna Toys</strong>, we pride ourselves on manufacturing top-tier products like pullback cars, PVC dolls, and educational board games directly from our Coimbatore factory.</p>
      <h3>Top Trends for 2026:</h3>
      <ul>
        <li><strong>Eco-Friendly Materials:</strong> Parents are demanding safer, non-toxic toys.</li>
        <li><strong>Interactive Learning:</strong> Board games and puzzles are seeing a massive resurgence.</li>
        <li><strong>Direct-to-Retail Wholesale:</strong> By cutting out middlemen, retailers can offer competitive prices.</li>
      </ul>
      <p>Stay tuned to our blog for more insights on maximizing your toy retail business!</p>
    `;

    const newBlog = new Blog({
      title: "Top Wholesale Toy Trends for Retailers in 2026",
      slug: "top-wholesale-toy-trends-2026",
      content: blogContent,
      excerpt: "Discover the latest trends in the B2B toy market in India, from eco-friendly materials to interactive learning toys.",
      author: "Bafna Toys Team",
      coverImage: uploadResult.url,
      tags: ["Wholesale", "Toy Trends", "Business Tips"],
      published: true,
      metaTitle: "Top Wholesale Toy Trends in India 2026 | Bafna Toys",
      metaDescription: "Learn about the top wholesale toy trends for retailers in 2026. Increase your toy shop's sales with insights from Bafna Toys.",
    });

    await newBlog.save();
    console.log("Blog successfully created!");

    mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

seedBlog();
