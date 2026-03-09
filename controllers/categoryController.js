const asyncHandler = require("express-async-handler");
const Category = require("../models/Category");

// POST /api/categories
const createCategory = asyncHandler(async (req, res) => {
  // 👇 Yahan 'link' nikalna zaroori hai
  const { name, link } = req.body;
  if (!name) {
    res.status(400);
    throw new Error("Category name is required");
  }

  const exists = await Category.findOne({ name });
  if (exists) {
    res.status(400);
    throw new Error("Category already exists");
  }

  // 👇 Yahan 'link' save karna zaroori hai
  const category = await Category.create({ name, link: link || "" });
  res.status(201).json(category);
});

// GET /api/categories
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({});
  res.json(categories);
});

// ⭐ NAYA FUNCTION: Category ko update/edit karne ke liye
const updateCategory = asyncHandler(async (req, res) => {
  const { name, link } = req.body;
  const category = await Category.findById(req.params.id);

  if (category) {
    category.name = name || category.name;
    
    // 👇 Link update karne ka logic
    if (link !== undefined) {
      category.link = link; 
    }

    const updatedCategory = await category.save();
    res.json(updatedCategory);
  } else {
    res.status(404);
    throw new Error("Category not found");
  }
});

// DELETE /api/categories/:id
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  await category.deleteOne(); // 'remove()' purana ho gaya hai, 'deleteOne()' use karein
  res.json({ message: "Category deleted" });
});

module.exports = {
  createCategory,
  getCategories,
  updateCategory, // 👇 Isko export karna zaroori hai
  deleteCategory,
};