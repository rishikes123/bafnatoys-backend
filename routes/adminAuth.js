const express = require("express");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin"); // Dhyan rakhna path sahi ho
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

// Note: Index cleanup was done once manually. No longer needed here.


// 1. ADMIN LOGIN (Railway .env Superadmin + DB Subadmins)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Username & password required" });
    }

    // CASE 1: Superadmin (.env)
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
      const token = jwt.sign(
        { username, role: "superadmin", isEnvAdmin: true },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      return res.json({
        message: "Superadmin login successful",
        token,
        admin: { username, role: "superadmin", permissions: ["all"] }
      });
    }

    // CASE 2: Subadmin (Database)
    const admin = await Admin.findOne({ username });
    if (admin && (await admin.matchPassword(password))) {
      const token = jwt.sign(
        { id: admin._id, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      return res.json({
        message: "Admin login successful",
        token,
        admin: { username: admin.username, role: admin.role, permissions: admin.permissions }
      });
    }

    res.status(401).json({ message: "Invalid credentials" });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// 2. CREATE NEW SUBADMIN (Only Superadmin)
router.post("/create", adminProtect, isAdmin, async (req, res) => {
  try {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ message: "Only Superadmin can create new admins" });
    }

    const { username, password, permissions } = req.body;
    
    // Check if user already exists
    const adminExists = await Admin.findOne({ username });
    if (adminExists) return res.status(400).json({ message: "Username already exists" });

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }

    const newAdmin = await Admin.create({
      username,
      password,
      role: "subadmin",
      permissions: permissions || []
    });

    res.status(201).json({ message: "Subadmin created successfully", username: newAdmin.username });
  } catch (err) {
    console.error("Create Admin Error:", err);
    res.status(500).json({ message: err.message || "Server error while creating admin" });
  }
});

// 3. GET ALL SUB-ADMINS (Frontend Table ke liye)
router.get("/list", adminProtect, isAdmin, async (req, res) => {
  try {
    const admins = await Admin.find({ role: "subadmin" }).select("-password").sort({ createdAt: -1 });
    res.json(admins);
  } catch (err) {
    console.error("Fetch Admin List Error:", err);
    res.status(500).json({ message: "Error fetching admin list" });
  }
});

// 4. UPDATE SUB-ADMIN (✅ EDIT KE LIYE PUT ROUTE - Jo miss ho gaya tha)
router.put("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ message: "Only Superadmin can edit admins" });
    }

    const { username, password, permissions } = req.body;
    const admin = await Admin.findById(req.params.id);

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Update details
    admin.username = username || admin.username;
    admin.permissions = permissions || admin.permissions;

    // Agar form se naya password aaya hai, tabhi usko hash kar ke save karo
    if (password && password.trim() !== "") {
      admin.password = password;
    }

    const updatedAdmin = await admin.save();
    res.json({ message: "Admin updated successfully", admin: { username: updatedAdmin.username } });
  } catch (err) {
    console.error("Update Admin Error:", err);
    res.status(500).json({ message: err.message || "Update failed" });
  }
});

// 5. DELETE SUB-ADMIN (Only Superadmin)
router.delete("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    if (req.user.role !== "superadmin") {
      return res.status(403).json({ message: "Not authorized to delete admins" });
    }

    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    await Admin.findByIdAndDelete(req.params.id);
    res.json({ message: "Admin removed successfully" });
  } catch (err) {
    console.error("Delete Admin Error:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;