const express = require("express");
const router = express.Router();
const GridLayout = require("../models/gridLayoutModel");

// 1. GET Route
router.get("/", async (req, res) => {
  try {
    let layout = await GridLayout.findOne({}); // ✅ Added {}
    
    if (!layout) {
      layout = await GridLayout.create({ pcColumns: 5, mobileColumns: 2 });
    }
    
    res.json(layout);
  } catch (error) {
    console.error("❌ Layout Fetch Error:", error);
    res.status(500).json({ message: "Error fetching layout" });
  }
});

// 2. PUT Route
router.put("/", async (req, res) => {
  try {
    const { pcColumns, mobileColumns } = req.body;
    
    let layout = await GridLayout.findOne({}); // ✅ Added {}
    if (!layout) {
      layout = new GridLayout();
    }
    
    if (pcColumns) layout.pcColumns = Number(pcColumns); // ✅ Converted to Number
    if (mobileColumns) layout.mobileColumns = Number(mobileColumns); // ✅ Converted to Number
    
    await layout.save();
    res.json({ message: "Layout updated successfully!", layout });
  } catch (error) {
    console.error("❌ Layout Save Error:", error);
    res.status(500).json({ message: "Error saving layout" });
  }
});

module.exports = router;