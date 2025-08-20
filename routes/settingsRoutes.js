const router = require("express").Router();
const Setting = require("../models/settingModel");

// GET current
router.get("/whatsapp", async (req, res) => {
  const doc = await Setting.findOne({ key: "whatsapp" });
  res.json(doc?.data || {});
});

// PUT save
router.put("/whatsapp", async (req, res) => {
  const data = req.body || {};
  const doc = await Setting.findOneAndUpdate(
    { key: "whatsapp" },
    { $set: { data } },
    { upsert: true, new: true }
  );
  res.json(doc.data);
});

module.exports = router;
