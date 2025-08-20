const asyncHandler = require("express-async-handler");
const Category = require("../models/Category");

// POST /api/categories
const createCategory = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) {
    res.status(400);
    throw new Error("Category name is required");
  }

  const exists = await Category.findOne({ name });
  if (exists) {
    res.status(400);
    throw new Error("Category already exists");
  }

  const category = await Category.create({ name });
  res.status(201).json(category);
});

// GET /api/categories
const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({});
  res.json(categories);
});

// DELETE /api/categories/:id
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  await category.remove();
  res.json({ message: "Category deleted" });
});

module.exports = {
  createCategory,
  getCategories,
  deleteCategory,
};
