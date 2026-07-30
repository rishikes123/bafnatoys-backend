const crypto = require("crypto");
const axios = require("axios");
const { GRAPH, metaError } = require("./metaAdsConfig");
const Registration = require("../models/Registration");
const Order = require("../models/orderModel");
const AbandonedCart = require("../models/AbandonedCart");

/*
  FIRST-PARTY AUDIENCE SYNC
  -------------------------
  Hamare paas 400+ registered retailers aur asli buyers ke mobile number hain.
  Wo data Meta ko dene se Meta "aise hi aur log" (Lookalike) dhoondh kar de
  deta hai — interest guessing se kaafi behtar.

  PRIVACY: mobile number kabhi plain me nahi jaata. Meta ka official tareeka
  SHA-256 hash hai — hum number ko normalize karke hash karte hain, aur sirf
  hash bhejte hain. Meta apni taraf bhi wahi hash banakar match karta hai.
*/

const AUDIENCE_NAMES = {
  registered: "BT — Registered Retailers",
  buyers: "BT — Buyers",
  abandoned: "BT — Abandoned Carts",
};

const CANCELLED = ["cancelled", "Cancelled", "CANCELLED", "canceled"];

/*
  Indian mobile ko Meta ke format me: sirf digits, country code ke saath, bina +
  9876543210      -> 919876543210
  +91 98765-43210 -> 919876543210
  09876543210     -> 919876543210
*/
function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^0+/, "");
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

function hashPhone(phone) {
  return crypto.createHash("sha256").update(phone).digest("hex");
}

// Ek source se saare valid, unique phone number nikaalta hai
async function collectPhones(source) {
  const phones = new Set();
  let rows = 0;
  let skipped = 0;

  const add = (...values) => {
    for (const v of values) {
      const n = normalizePhone(v);
      if (n) { phones.add(n); return true; }
    }
    skipped++;
    return false;
  };

  if (source === "registered") {
    const list = await Registration.find({ isBlocked: { $ne: true } })
      .select("otpMobile whatsapp")
      .lean();
    rows = list.length;
    for (const r of list) add(r.otpMobile, r.whatsapp);
  } else if (source === "buyers") {
    const list = await Order.find({ status: { $nin: CANCELLED } })
      .select("customerId shippingAddress.phone")
      .lean();
    rows = list.length;
    const needLookup = [];
    for (const o of list) {
      if (!add(o.shippingAddress?.phone) && o.customerId) needLookup.push(o.customerId);
    }
    // Jin orders me phone nahi mila, unka registration se utha lo
    if (needLookup.length) {
      const regs = await Registration.find({ _id: { $in: needLookup } })
        .select("otpMobile whatsapp")
        .lean();
      for (const r of regs) add(r.otpMobile, r.whatsapp);
    }
  } else if (source === "abandoned") {
    const list = await AbandonedCart.find({ status: { $ne: "recovered" } })
      .select("mobile whatsapp")
      .lean();
    rows = list.length;
    for (const c of list) add(c.mobile, c.whatsapp);
  } else {
    throw new Error("Source galat hai (registered / buyers / abandoned)");
  }

  return { phones: [...phones], rows, skipped };
}

// Teeno source ka count — UI me button ke saath dikhane ke liye
async function sourceCounts() {
  const out = {};
  for (const source of Object.keys(AUDIENCE_NAMES)) {
    try {
      const { phones, rows } = await collectPhones(source);
      out[source] = { name: AUDIENCE_NAMES[source], rows, usable: phones.length };
    } catch {
      out[source] = { name: AUDIENCE_NAMES[source], rows: 0, usable: 0 };
    }
  }
  return out;
}

/*
  CUSTOMER LIST TERMS check.
  Meta ke do alag ToS hote hain:
    web_custom_audience_tos -> pixel/website audiences (ye aam taur pe accept hoti hai)
    custom_audience_tos     -> customer list upload (mobile number wali) — ye alag se chahiye
  Ye accept na ho to Meta sirf "Permissions error" bhejta hai, jisse kuch samajh
  nahi aata. Isliye pehle hi check karke saaf message dete hain.
*/
function tosUrl(adAccountId) {
  return `https://business.facebook.com/ads/manage/customaudiences/tos/?act=${adAccountId}`;
}

async function checkCustomerListTos(cfg) {
  try {
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}`, {
      params: { fields: "tos_accepted", access_token: cfg.accessToken },
    });
    const tos = data.tos_accepted || {};
    return {
      known: true,
      accepted: Boolean(tos.custom_audience_tos),
      websiteAccepted: Boolean(tos.web_custom_audience_tos),
      url: tosUrl(cfg.adAccountId),
    };
  } catch {
    // Padh nahi paye to rok nahi lagate — Meta khud bata dega
    return { known: false, accepted: true, websiteAccepted: false, url: tosUrl(cfg.adAccountId) };
  }
}

// Meta pe already bani audiences (naam se dhoondhne ke liye)
async function listAudiences(cfg) {
  const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/customaudiences`, {
    params: {
      fields:
        "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_updated",
      limit: 200,
      access_token: cfg.accessToken,
    },
  });
  return data.data || [];
}

// Customer-list audience — pehle se ho to wahi, warna nayi bana do
async function ensureCustomerListAudience(cfg, name, description) {
  const existing = (await listAudiences(cfg)).find((a) => a.name === name);
  if (existing) return { id: existing.id, created: false };

  const { data } = await axios.post(`${GRAPH}/act_${cfg.adAccountId}/customaudiences`, null, {
    params: {
      name,
      subtype: "CUSTOM",
      description: description || "Bafnatoys panel se bheji gayi list",
      customer_file_source: "USER_PROVIDED_ONLY", // data hamara khud ka hai
      access_token: cfg.accessToken,
    },
  });
  return { id: data.id, created: true };
}

/*
  Hashed number Meta pe bhejo. Meta ek call me bahut saare le leta hai,
  par safe rehne ke liye 5000 ke chunk me bhejte hain.
*/
async function uploadPhones(cfg, audienceId, phones) {
  const CHUNK = 5000;
  let sent = 0;
  const batches = [];

  for (let i = 0; i < phones.length; i += CHUNK) {
    const slice = phones.slice(i, i + CHUNK);
    const payload = {
      schema: ["PHONE"],
      data: slice.map((p) => [hashPhone(p)]),
    };
    const { data } = await axios.post(
      `${GRAPH}/${audienceId}/users`,
      new URLSearchParams({ payload: JSON.stringify(payload), access_token: cfg.accessToken }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxBodyLength: Infinity }
    );
    sent += Number(data?.num_received ?? slice.length);
    batches.push({ count: slice.length, received: data?.num_received ?? null });
  }
  return { sent, batches };
}

/*
  Lookalike: Meta source audience jaise naye log dhoondhta hai.
  ratio 0.01 = top 1% (sabse milte-julte), 0.05 = 5% (zyada log, thoda dheela match)
*/
async function createLookalike(cfg, originAudienceId, { name, ratio = 0.01, country = "IN" } = {}) {
  const safeRatio = Math.min(0.2, Math.max(0.01, Number(ratio) || 0.01));
  const { data } = await axios.post(`${GRAPH}/act_${cfg.adAccountId}/customaudiences`, null, {
    params: {
      name: name || `BT — Lookalike ${Math.round(safeRatio * 100)}% (${country})`,
      subtype: "LOOKALIKE",
      origin_audience_id: originAudienceId,
      lookalike_spec: JSON.stringify({ type: "similarity", country, ratio: safeRatio }),
      access_token: cfg.accessToken,
    },
  });
  return { id: data.id, ratio: safeRatio, country };
}

/*
  Meta ki do galtiyan bahut aam hain — unko saaf Hinglish me badal dete hain,
  warna admin ko samajh nahi aata ki karna kya hai.
*/
function audienceError(err, cfg) {
  const e = err?.response?.data?.error;
  const msg = e?.message || err?.message || "";
  const sub = e?.error_subcode;
  const link = cfg?.adAccountId ? tosUrl(cfg.adAccountId) : "business.facebook.com → Audiences";

  // "Permissions error" Meta ka sabse aam (aur sabse bekaar) jawab hai jab
  // customer-list terms accept nahi hui hoti
  if (sub === 2654 || /Terms of Service|custom audience terms|Permissions error/i.test(msg)) {
    return `Customer List Terms accept nahi hui hain — isliye mobile number wali audience nahi ban rahi. Ye link kholo aur Accept dabao: ${link}  (Website/pixel wali terms already accept hain, customer list wali alag hoti hai.)`;
  }
  if (/not have permission|ads_management/i.test(msg)) {
    return "Token ke paas ads_management permission nahi hai. System user ka token dobara generate karo (ads_management tick karke).";
  }
  return msg || "Audience banate waqt dikkat aayi";
}

module.exports = {
  AUDIENCE_NAMES,
  normalizePhone,
  hashPhone,
  collectPhones,
  sourceCounts,
  checkCustomerListTos,
  tosUrl,
  listAudiences,
  ensureCustomerListAudience,
  uploadPhones,
  createLookalike,
  audienceError,
  metaError,
};
