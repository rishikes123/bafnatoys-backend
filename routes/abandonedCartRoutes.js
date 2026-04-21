// backend/routes/abandonedCartRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const AbandonedCart = require("../models/AbandonedCart");
const Registration = require("../models/Registration");
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

    const doc = await AbandonedCart.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          shopName: user.shopName || "",
          mobile: user.otpMobile || "",
          whatsapp: user.whatsapp || user.otpMobile || "",
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
      page = 1,
      limit = 25,
    } = req.query;

    const filter = {};
    if (status && status !== "all") filter.status = status;

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
      filter.$or = [{ shopName: rx }, { mobile: rx }, { whatsapp: rx }];
    }

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (p - 1) * l;

    const [items, total] = await Promise.all([
      AbandonedCart.find(filter)
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(l)
        .lean(),
      AbandonedCart.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l),
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
    } = req.body || {};

    if (!templateName) {
      return res.status(400).json({ message: "templateName is required" });
    }

    const cart = await AbandonedCart.findById(id);
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const to = toE164India(cart.whatsapp || cart.mobile);
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
