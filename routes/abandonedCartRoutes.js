// backend/routes/abandonedCartRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const AbandonedCart = require("../models/AbandonedCart");
const Registration = require("../models/Registration");
const Address = require("../models/Address");
const { protect, adminProtect } = require("../middleware/authMiddleware");
const { sendWhatsAppTemplate } = require("../services/whatsappService");

/* ========================================================================
   HELPERS
   ======================================================================== */

function onlyDigits(s = "") {
  return String(s || "").replace(/\D/g, "");
}

/**
 * Ensure phone has country code. India default +91.
 * Accepts:  9876543210       -> 919876543210
 *           919876543210     -> 919876543210
 *           +91 98765 43210  -> 919876543210
 */
function toE164India(raw = "") {
  const d = onlyDigits(raw);
  if (!d) return "";
  if (d.length === 10) return "91" + d;
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 13 && d.startsWith("091")) return d.slice(1);
  return d; // fallback — send as-is
}

/**
 * Sanitize and normalize cart items posted from client.
 * Drops malformed items.
 */
function sanitizeItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => {
      const productId =
        it.productId && mongoose.isValidObjectId(it.productId)
          ? it.productId
          : it._id && mongoose.isValidObjectId(it._id)
          ? it._id
          : null;
      return {
        productId,
        name: String(it.name || "").slice(0, 200),
        price: Number(it.price) || 0,
        quantity: Math.max(1, Math.floor(Number(it.quantity) || 0)),
        image: String(it.image || (Array.isArray(it.images) ? it.images[0] : "") || "").slice(0, 500),
        slug: String(it.slug || "").slice(0, 200),
      };
    })
    .filter((it) => it.name && it.price >= 0 && it.quantity >= 1);
}

function parseCustomerAddress(str = "") {
  if (!str || typeof str !== "string") return { city: "", state: "", fullAddress: "" };
  const sMatch = str.match(/State\s*:\s*([^\n\r,]+)/i);
  const cMatch = str.match(/City\s*:\s*([^\n\r,]+)/i);
  const aMatch = str.match(/Address\s*:\s*([^\n\r]+)/i);
  const pMatch = str.match(/Pin\s*Code\s*:\s*([^\n\r]+)/i);

  const state = sMatch ? sMatch[1].trim() : "";
  const city = cMatch ? cMatch[1].trim() : "";
  const street = aMatch ? aMatch[1].trim() : "";
  const pincode = pMatch ? pMatch[1].trim() : "";

  let fullAddress = str;
  if (state || city || street) {
    fullAddress = [street, city, state, pincode].filter(Boolean).join(", ");
  } else {
    fullAddress = str.replace(/[\n\r]+/g, ", ").trim();
  }

  return { city, state, fullAddress };
}

/* ========================================================================
   CUSTOMER-FACING
   ======================================================================== */

/**
 * POST /api/abandoned-cart/sync
 * Body: { items: [...] }
 *
 * Called from frontend (debounced) whenever cart changes for logged-in users.
 * - items empty  => mark existing as "recovered" (they cleared cart manually)
 * - items non-empty => upsert active abandoned cart
 */
router.post("/sync", protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const items = sanitizeItems(req.body?.items);

    const user = await Registration.findById(userId).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // Empty cart — clear any active record
    if (items.length === 0) {
      await AbandonedCart.findOneAndUpdate(
        { userId, status: "active" },
        { $set: { status: "recovered", recoveredAt: new Date() } },
        { new: false }
      );
      return res.json({ ok: true, status: "cleared" });
    }

    const totalValue = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const itemCount = items.reduce((s, it) => s + it.quantity, 0);

    // Look up default or latest address for city/state
    const userAddress = await Address.findOne({ user: userId })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();
    const parsed = parseCustomerAddress(user?.address || "");

    const city = userAddress?.city || parsed.city || "";
    const state = userAddress?.state || parsed.state || "";
    const fullAddress = userAddress
      ? [userAddress.street, userAddress.area, userAddress.city, userAddress.state, userAddress.pincode]
          .filter(Boolean)
          .join(", ")
      : (parsed.fullAddress || user?.address || "");

    const doc = await AbandonedCart.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          shopName: user.shopName || "",
          mobile: user.otpMobile || "",
          whatsapp: user.whatsapp || user.otpMobile || "",
          city,
          state,
          address: fullAddress,
          items,
          totalValue,
          itemCount,
          lastActivityAt: new Date(),
          status: "active",
          recoveredOrderId: null,
          recoveredAt: null,
        },
      },
      { upsert: true, new: true }
    );

    res.json({ ok: true, status: "active", id: doc._id });
  } catch (err) {
    console.error("abandoned-cart/sync error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * POST /api/abandoned-cart/recovered
 * Body: { orderId? }
 *
 * Called after successful checkout — mark cart as recovered and link order.
 */
router.post("/recovered", protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const { orderId } = req.body || {};

    const update = {
      status: "recovered",
      recoveredAt: new Date(),
    };
    if (orderId && mongoose.isValidObjectId(orderId)) {
      update.recoveredOrderId = orderId;
    }

    await AbandonedCart.findOneAndUpdate(
      { userId, status: "active" },
      { $set: update }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("abandoned-cart/recovered error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/* ========================================================================
   ADMIN-FACING
   ======================================================================== */

/**
 * GET /api/abandoned-cart/admin/list
 * Query: ?status=active&minValue=0&hours=24&search=&page=1&limit=25
 */
router.get("/admin/list", adminProtect, async (req, res) => {
  try {
    const {
      status = "active",
      minValue,
      hours,
      search,
      state,
      followUpStatus,
      page = 1,
      limit = 25,
    } = req.query;

    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (followUpStatus && followUpStatus !== "all") filter.followUpStatus = followUpStatus;

    if (minValue) {
      const v = Number(minValue);
      if (!Number.isNaN(v)) filter.totalValue = { $gte: v };
    }

    if (hours) {
      const h = Number(hours);
      if (!Number.isNaN(h) && h > 0) {
        filter.lastActivityAt = { $gte: new Date(Date.now() - h * 3600 * 1000) };
      }
    }

    if (search) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { shopName: rx },
        { mobile: rx },
        { whatsapp: rx },
        { city: rx },
        { state: rx },
        { address: rx },
      ];
    }

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (p - 1) * l;

    // First fetch all matching carts
    const [rawItems, allCartsForStates] = await Promise.all([
      AbandonedCart.find(filter)
        .populate("userId", "shopName address otpMobile whatsapp")
        .sort({ lastActivityAt: -1 })
        .lean(),
      AbandonedCart.find({ status: status !== "all" ? status : { $exists: true } })
        .populate("userId", "shopName address")
        .lean(),
    ]);

    // Fetch matching addresses for all users
    const allUserIds = Array.from(
      new Set(
        [...rawItems, ...allCartsForStates]
          .map((it) => it.userId?._id || it.userId)
          .filter(Boolean)
          .map(String)
      )
    );

    const addresses = await Address.find({ user: { $in: allUserIds } })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();

    const addressMap = {};
    for (const addr of addresses) {
      const uid = String(addr.user);
      if (!addressMap[uid]) {
        addressMap[uid] = addr;
      }
    }

    // Helper to resolve state/city
    const resolveLocation = (it) => {
      const uid = String(it.userId?._id || it.userId);
      const addr = addressMap[uid];
      const userObj = it.userId && typeof it.userId === "object" ? it.userId : null;
      const parsed = parseCustomerAddress(userObj?.address || "");

      const city = it.city || addr?.city || parsed.city || "";
      const st = it.state || addr?.state || parsed.state || "";
      const fullAddress =
        it.address ||
        (addr
          ? [addr.street, addr.area, addr.city, addr.state, addr.pincode]
              .filter(Boolean)
              .join(", ")
          : parsed.fullAddress || userObj?.address || "");

      return {
        ...it,
        shopName: it.shopName || userObj?.shopName || "",
        mobile: it.mobile || userObj?.otpMobile || "",
        whatsapp: it.whatsapp || userObj?.whatsapp || userObj?.otpMobile || "",
        city,
        state: st,
        address: fullAddress,
        followUpStatus: it.followUpStatus || "pending",
        followUpNotes: it.followUpNotes || "",
        contactMethod: it.contactMethod || "none",
        lastContactedAt: it.lastContactedAt || null,
      };
    };

    // Extract all unique available states
    const stateSet = new Set();
    allCartsForStates.forEach((c) => {
      const resolved = resolveLocation(c);
      if (resolved.state && resolved.state.trim()) {
        stateSet.add(resolved.state.trim());
      }
    });
    const availableStates = Array.from(stateSet).sort((a, b) => a.localeCompare(b));

    // Resolve all raw items
    let resolvedItems = rawItems.map(resolveLocation);

    // Apply state filter if selected
    if (state && state !== "all") {
      const targetState = String(state).trim().toLowerCase();
      resolvedItems = resolvedItems.filter(
        (it) => (it.state || "").trim().toLowerCase() === targetState
      );
    }

    const total = resolvedItems.length;
    const items = resolvedItems.slice(skip, skip + l);

    res.json({
      items,
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l) || 1,
      availableStates,
    });
  } catch (err) {
    console.error("abandoned-cart/admin/list error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * GET /api/abandoned-cart/admin/stats
 * High-level KPIs for dashboard card.
 */
router.get("/admin/stats", adminProtect, async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 3600 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const [active, recovered7d, valueActive, value24h] = await Promise.all([
      AbandonedCart.countDocuments({ status: "active" }),
      AbandonedCart.countDocuments({
        status: "recovered",
        recoveredAt: { $gte: last7d },
      }),
      AbandonedCart.aggregate([
        { $match: { status: "active" } },
        { $group: { _id: null, sum: { $sum: "$totalValue" } } },
      ]),
      AbandonedCart.aggregate([
        {
          $match: {
            status: "active",
            lastActivityAt: { $gte: last24h },
          },
        },
        { $group: { _id: null, sum: { $sum: "$totalValue" }, count: { $sum: 1 } } },
      ]),
    ]);

    // Recovery rate (last 7 days)
    const totalWindow = await AbandonedCart.countDocuments({
      $or: [
        { status: "recovered", recoveredAt: { $gte: last7d } },
        { status: "active", lastActivityAt: { $gte: last7d } },
      ],
    });
    const recoveryRate =
      totalWindow > 0 ? Math.round((recovered7d / totalWindow) * 100) : 0;

    res.json({
      active,
      activeValue: valueActive?.[0]?.sum || 0,
      last24hCount: value24h?.[0]?.count || 0,
      last24hValue: value24h?.[0]?.sum || 0,
      recovered7d,
      recoveryRate,
    });
  } catch (err) {
    console.error("abandoned-cart/admin/stats error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * POST /api/abandoned-cart/admin/:id/send-whatsapp
 * Body:
 * {
 *   templateName: "abandoned_cart_reminder",
 *   languageCode: "en_US",
 *   components: [                    // optional — fully overrides auto-fill
 *     { type: "body", parameters: [{ type: "text", text: "..." }] }
 *   ]
 * }
 *
 * If `components` is not provided, the route builds a default BODY with 4 vars:
 *   {{1}} = customer shop name
 *   {{2}} = item count (e.g. "3 items")
 *   {{3}} = total value (e.g. "₹2,450")
 *   {{4}} = recovery URL (https://bafnatoys.com/cart)
 *
 * So on Meta side the owner should create a template with BODY text like:
 *   "Hi {{1}}, aapke cart me {{2}} hain worth {{3}}. Complete karo: {{4}}"
 */
router.post("/admin/:id/send-whatsapp", adminProtect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const {
      templateName,
      languageCode = "en_US",
      components: customComponents,
      recoveryUrl = "https://bafnatoys.com/cart",
      overridePhone,
    } = req.body || {};

    if (!templateName) {
      return res.status(400).json({ message: "templateName is required" });
    }

    const cart = await AbandonedCart.findById(id);
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const to = toE164India(overridePhone || cart.whatsapp || cart.mobile);
    if (!to) {
      return res.status(400).json({ message: "Customer has no valid phone" });
    }

    // Build default BODY components if caller didn't pass custom ones
    const components =
      Array.isArray(customComponents) && customComponents.length
        ? customComponents
        : [
            {
              type: "body",
              parameters: [
                { type: "text", text: cart.shopName || "Customer" },
                { type: "text", text: `${cart.itemCount} items` },
                { type: "text", text: `Rs ${Math.round(cart.totalValue)}` },
                { type: "text", text: recoveryUrl },
              ],
            },
          ];

    // Send via existing service
    let result, errorMsg = "", messageId = "";
    try {
      result = await sendWhatsAppTemplate({
        to,
        templateName,
        languageCode,
        components,
      });
      messageId = result?.messages?.[0]?.id || "";
    } catch (sendErr) {
      errorMsg =
        sendErr?.response?.data?.error?.message ||
        sendErr?.message ||
        "Unknown WhatsApp send error";
    }

    // Log the attempt
    const logEntry = {
      sentAt: new Date(),
      template: templateName,
      languageCode,
      status: errorMsg ? "failed" : "sent",
      messageId,
      error: errorMsg,
      sentBy: req.admin?.username || req.admin?.user || "admin",
    };

    cart.whatsappSent.push(logEntry);
    if (!errorMsg) {
      cart.lastWhatsappAt = logEntry.sentAt;
      cart.reminderCount = (cart.reminderCount || 0) + 1;
      if (cart.followUpStatus === "pending") {
        cart.followUpStatus = "messaged";
        cart.contactMethod = cart.contactMethod === "call" ? "both" : "whatsapp";
        cart.lastContactedAt = new Date();
      }
    }
    await cart.save();

    if (errorMsg) {
      return res.status(502).json({ ok: false, message: errorMsg, log: logEntry });
    }
    res.json({ ok: true, log: logEntry, wa: result });
  } catch (err) {
    console.error("abandoned-cart/admin/send-whatsapp error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * PATCH /api/abandoned-cart/admin/:id/follow-up
 * Body: { followUpStatus, followUpNotes?, contactMethod? }
 * Statuses: 'pending' | 'called' | 'messaged' | 'completed' | 'not_interested'
 */
router.patch("/admin/:id/follow-up", adminProtect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const { followUpStatus, followUpNotes, contactMethod } = req.body || {};
    const allowed = ["pending", "called", "messaged", "completed", "not_interested"];
    if (followUpStatus && !allowed.includes(followUpStatus)) {
      return res.status(400).json({ message: "Invalid followUpStatus" });
    }

    const update = {};
    if (followUpStatus) update.followUpStatus = followUpStatus;
    if (typeof followUpNotes === "string") update.followUpNotes = followUpNotes;
    if (contactMethod) update.contactMethod = contactMethod;
    if (["called", "messaged", "completed"].includes(followUpStatus)) {
      update.lastContactedAt = new Date();
    }

    const doc = await AbandonedCart.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true, doc });
  } catch (err) {
    console.error("abandoned-cart/admin/follow-up error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * PATCH /api/abandoned-cart/admin/:id/dismiss
 * Mark a cart as dismissed (admin decision — stops follow-ups).
 */
router.patch("/admin/:id/dismiss", adminProtect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const doc = await AbandonedCart.findByIdAndUpdate(
      id,
      { $set: { status: "dismissed" } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true, doc });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/**
 * DELETE /api/abandoned-cart/admin/:id
 */
router.delete("/admin/:id", adminProtect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    await AbandonedCart.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

module.exports = router;
