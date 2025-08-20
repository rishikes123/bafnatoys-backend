// backend/middleware/adminProtect.js
const jwt = require("jsonwebtoken");

function adminProtect(req, res, next) {
  try {
    const header = req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = header.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.role !== "admin") {
      return res.status(403).json({ message: "Not an admin token" });
    }

    req.admin = { user: decoded.user };
    next();
  } catch (err) {
    console.error("adminProtect error:", err);
    return res.status(401).json({ message: "Invalid/expired token" });
  }
}

module.exports = { adminProtect };
