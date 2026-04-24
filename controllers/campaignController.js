// backend/controllers/campaignController.js
// Bulk WhatsApp campaign — send template message to N customers.
// Audience: all / active30 / active90 / recent / excel / manual
const Campaign = require("../models/Campaign");
const Registration = require("../models/Registration");
const Order = require("../models/orderModel");
const Product = require("../models/Product");
const { sendWhatsAppTemplate } = require("../services/whatsappService");

/* ---------------- helpers ---------------- */

// Normalize a phone to E.164 India default (+91). Strips spaces/dashes.
function normalizePhone(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("91") && s.length === 12) return "+" + s;
  if (s.length === 10) return "+91" + s;
  return s.startsWith("+") ? s : "+" + s;
}

// Build components array for Meta template
function buildComponents({ bodyVariables = [], headerType = "none", headerValue = "" }) {
  const comps = [];

  if (headerType && headerType !== "none" && headerValue) {
    if (headerType === "text") {
      comps.push({
        type: "header",
        parameters: [{ type: "text", text: String(headerValue) }],
      });
    } else if (headerType === "image") {
      comps.push({
        type: "header",
        parameters: [{ type: "image", image: { link: headerValue } }],
      });
    } else if (headerType === "video") {
      comps.push({
        type: "header",
        parameters: [{ type: "video", video: { link: headerValue } }],
      });
    } else if (headerType === "document") {
      comps.push({
        type: "header",
        parameters: [{ type: "document", document: { link: headerValue } }],
      });
    }
  }

  if (bodyVariables && bodyVariables.length > 0) {
    comps.push({
      type: "body",
      parameters: bodyVariables.map((v) => ({ type: "text", text: String(v ?? "") })),
    });
  }

  return comps;
}

// Resolve audience into a de-duped recipient list
async function resolveAudience({ audienceType, customNumbers = [] }) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Manual / Excel path — numbers provided by admin
  if (audienceType === "excel" || audienceType === "manual") {
    const list = (Array.isArray(customNumbers) ? customNumbers : [])
      .map((r) => {
        if (typeof r === "string") return { phone: normalizePhone(r), name: "" };
        return {
          phone: normalizePhone(r?.phone || r?.number || r?.mobile || ""),
          name: r?.name || r?.shopName || "",
          userId: null,
        };
      })
      .filter((r) => r.phone);
    return dedupe(list);
  }

  // DB-backed audiences
  let customerFilter = {};
  if (audienceType === "recent") {
    customerFilter = { createdAt: { $gte: new Date(now - 30 * day) } };
  }

  let customers = await Registration.find(customerFilter)
    .select("_id shopName otpMobile whatsapp")
    .lean();

  // active30 / active90 → filter to customers with orders in window
  if (audienceType === "active30" || audienceType === "active90") {
    const days = audienceType === "active30" ? 30 : 90;
    const recentBuyers = await Order.distinct("customerId", {
      createdAt: { $gte: new Date(now - days * day) },
    });
    const set = new Set(recentBuyers.map((x) => String(x)));
    customers = customers.filter((c) => set.has(String(c._id)));
  }

  const list = customers.map((c) => ({
    phone: normalizePhone(c.whatsapp || c.otpMobile),
    name: c.shopName || "",
    userId: c._id,
  })).filter((r) => r.phone);

  return dedupe(list);
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const r of arr) {
    if (!r.phone) continue;
    if (seen.has(r.phone)) continue;
    seen.add(r.phone);
    out.push(r);
  }
  return out;
}

/* ---------------- async background sender ---------------- */

async function runCampaign(campaignId) {
  // Small delay between messages to respect Meta rate limit (~80/sec cap).
  // We go conservative: ~10/sec = 100ms delay.
  const PER_MESSAGE_DELAY_MS = 120;

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;

  try {
    campaign.status = "running";
    campaign.startedAt = new Date();
    await campaign.save();

    const comps = buildComponents({
      bodyVariables: campaign.bodyVariables,
      headerType: campaign.headerType,
      headerValue: campaign.headerValue,
    });

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < campaign.messages.length; i++) {
      const msg = campaign.messages[i];
      if (msg.status !== "queued") continue;

      msg.attemptedAt = new Date();

      try {
        const resp = await sendWhatsAppTemplate({
          to: msg.phone,
          templateName: campaign.templateName,
          languageCode: campaign.languageCode,
          components: comps,
        });

        msg.status = "sent";
        msg.sentAt = new Date();
        msg.messageId = resp?.messages?.[0]?.id || "";
        sent++;
      } catch (err) {
        msg.status = "failed";
        const details = err?.response?.data?.error?.message || err?.message || "send failed";
        msg.error = String(details).slice(0, 500);
        failed++;
      }

      // Persist progress every 10 messages to avoid losing state on crash
      if ((i + 1) % 10 === 0) {
        campaign.sentCount = sent;
        campaign.failedCount = failed;
        campaign.queuedCount = campaign.messages.length - sent - failed;
        await campaign.save();
      }

      await new Promise((r) => setTimeout(r, PER_MESSAGE_DELAY_MS));
    }

    campaign.sentCount = sent;
    campaign.failedCount = failed;
    campaign.queuedCount = 0;
    campaign.finishedAt = new Date();
    campaign.status = failed > 0 ? "completed_with_errors" : "completed";
    await campaign.save();
  } catch (err) {
    console.error("❌ runCampaign fatal:", err);
    try {
      campaign.status = "completed_with_errors";
      campaign.finishedAt = new Date();
      await campaign.save();
    } catch (_) {}
  }
}

/* ---------------- REST endpoints ---------------- */

// GET /api/campaigns/preview?audienceType=all
exports.previewAudience = async (req, res) => {
  try {
    const audienceType = String(req.query.audienceType || "all");
    const list = await resolveAudience({ audienceType });
    return res.json({ success: true, count: list.length, sample: list.slice(0, 5) });
  } catch (err) {
    console.error("previewAudience error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/campaigns
// body: { name, audienceType, customNumbers[], templateName, languageCode,
//         bodyVariables[], headerType, headerValue, productId, offerNote }
exports.createCampaign = async (req, res) => {
  try {
    const {
      name,
      audienceType = "all",
      customNumbers = [],
      templateName,
      languageCode = "en_US",
      bodyVariables = [],
      headerType = "none",
      headerValue = "",
      productId = null,
      offerNote = "",
    } = req.body || {};

    if (!name || !templateName) {
      return res
        .status(400)
        .json({ success: false, message: "name and templateName required" });
    }

    const recipients = await resolveAudience({ audienceType, customNumbers });
    if (recipients.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No recipients found for this audience." });
    }

    const messages = recipients.map((r) => ({
      phone: r.phone,
      name: r.name || "",
      userId: r.userId || undefined,
      status: "queued",
    }));

    const campaign = await Campaign.create({
      name,
      audienceType,
      templateName,
      languageCode,
      bodyVariables: Array.isArray(bodyVariables) ? bodyVariables : [],
      headerType,
      headerValue,
      productId: productId || null,
      offerNote,
      totalRecipients: messages.length,
      queuedCount: messages.length,
      sentCount: 0,
      failedCount: 0,
      status: "draft",
      messages,
      createdBy: req.admin?.username || req.user?.name || "admin",
    });

    // Fire-and-forget background sender
    setImmediate(() => runCampaign(campaign._id));

    return res.json({
      success: true,
      campaignId: campaign._id,
      totalRecipients: messages.length,
    });
  } catch (err) {
    console.error("createCampaign error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaigns?page=1&limit=20
exports.listCampaigns = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Campaign.find({})
        .select("-messages") // list view — hide message logs for speed
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Campaign.countDocuments({}),
    ]);

    return res.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error("listCampaigns error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaigns/:id
exports.getCampaign = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id).lean();
    if (!c) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, campaign: c });
  } catch (err) {
    console.error("getCampaign error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/campaigns/:id/cancel  — marks remaining queued messages as cancelled
exports.cancelCampaign = async (req, res) => {
  try {
    const c = await Campaign.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Not found" });
    if (c.status === "completed" || c.status === "completed_with_errors") {
      return res.status(400).json({ success: false, message: "Already finished" });
    }
    c.status = "cancelled";
    c.finishedAt = new Date();
    await c.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("cancelCampaign error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaigns/product-link/:id — helper to build product URL for variables
exports.getProductLink = async (req, res) => {
  try {
    const p = await Product.findById(req.params.id).select("name slug").lean();
    if (!p) return res.status(404).json({ success: false, message: "Not found" });
    const slug = p.slug || p._id;
    return res.json({
      success: true,
      name: p.name,
      url: `https://bafnatoys.com/product/${slug}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
