const express = require('express');
const router = express.Router();
const Category = require('../models/categoryModel'); // <-- Make sure this exists!

// Get all categories
router.get('/', async (req, res) => {
  const cats = await Category.find();
  res.json(cats);
});

// Create a new category
router.post('/', async (req, res) => {
  const cat = new Category({ name: req.body.name });
  await cat.save();
  res.status(201).json(cat);
});

// Update a category
router.put('/:id', async (req, res) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return res.status(404).json({ message: "Category not found" });
  cat.name = req.body.name;
  await cat.save();
  res.json(cat);
});

// Delete a category
router.delete('/:id', async (req, res) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return res.status(404).json({ message: "Category not found" });
  await cat.deleteOne();
  res.json({ message: "Deleted" });
});

module.exports = router;
