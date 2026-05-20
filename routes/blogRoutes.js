const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// PUBLIC ROUTES

// Get all published blogs
router.get("/", async (req, res) => {
  try {
    const blogs = await Blog.find({ published: true }).sort({ createdAt: -1 });
    res.json(blogs);
  } catch (error) {
    console.error("Error fetching blogs:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get single blog by slug
router.get("/:slug", async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug, published: true });
    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }
    res.json(blog);
  } catch (error) {
    console.error("Error fetching blog:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ADMIN ROUTES

// Get all blogs (including unpublished) for admin
router.get("/admin/all", adminProtect, isAdmin, async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ createdAt: -1 });
    res.json(blogs);
  } catch (error) {
    console.error("Error fetching admin blogs:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create a new blog
router.post("/", adminProtect, isAdmin, async (req, res) => {
  try {
    const { title, slug, content, coverImage, excerpt, author, tags, published, metaTitle, metaDescription } = req.body;
    
    // Check if slug exists
    const existing = await Blog.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: "Blog with this slug already exists" });
    }

    const blog = new Blog({
      title, slug, content, coverImage, excerpt, author, tags, published, metaTitle, metaDescription
    });

    await blog.save();
    res.status(201).json(blog);
  } catch (error) {
    console.error("Error creating blog:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a blog
router.put("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }
    res.json(blog);
  } catch (error) {
    console.error("Error updating blog:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete a blog
router.delete("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: "Blog not found" });
    }
    res.json({ message: "Blog deleted successfully" });
  } catch (error) {
    console.error("Error deleting blog:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
