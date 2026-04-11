const jwt = require("jsonwebtoken");
const Registration = require("../models/Registration");
const Admin = require("../models/Admin"); 

// ==========================================
// 1. CUSTOMER PROTECT (For Frontend Users)
// ==========================================
const protect = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No valid token provided" });
    }

    const token = authHeader.substring(7);

    // ✅ FIX: Agar localstorage khali hai aur frontend ne "null" bhej diya
    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({ message: "Token is null or undefined" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await Registration.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    // Console error hata diya taaki terminal clean rahe
    res.status(401).json({ message: "Not authorized, invalid token" });
  }
};

// ==========================================
// 2. ADMIN PROTECT (For Dashboard Admins)
// ==========================================
const adminProtect = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No valid token provided" });
    }

    const token = authHeader.substring(7);

    // ✅ FIX: Admin token safety check
    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({ message: "Admin token is null or undefined" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if it is the Superadmin from .env file
    if (decoded.isEnvAdmin) {
      req.admin = { username: decoded.username, role: decoded.role };
      req.user = req.admin; // Adding to req.user for consistency
      return next();
    }

    // Check if it is a Subadmin from Database
    const admin = await Admin.findById(decoded.id).select("-password");
    if (!admin) {
      return res.status(401).json({ message: "Admin not found" });
    }

    req.admin = admin;
    req.user = admin; 
    next();
  } catch (err) {
    res.status(401).json({ message: "Not authorized, invalid admin token" });
  }
};

// ==========================================
// 3. IS ADMIN ROLE CHECK
// ==========================================
const isAdmin = (req, res, next) => {
  // Check both req.admin and req.user just to be safe
  const user = req.admin || req.user; 
  
  if (user && (user.role === "superadmin" || user.role === "subadmin" || user.role === "admin")) {
    next();
  } else {
    res.status(403).json({ message: "Not authorized as an admin" });
  }
};

// ✅ Exporting ALL functions so no route gives the "undefined" error
module.exports = { protect, adminProtect, isAdmin };