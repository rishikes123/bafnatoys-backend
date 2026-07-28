const router = require("express").Router();
const axios = require("axios");
const Setting = require("../models/settingModel");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

/*
  META ADS PANEL
  --------------
  Ye route Meta Marketing (Graph) API se baat karta hai taaki admin panel me
  live campaigns dikh sake aur edit ho sake.

  Zaroori: Setting key "meta-ads" me { adAccountId, accessToken, enabled } save hota hai.
  Token kabhi bhi frontend ko wapas nahi bheja jaata (sirf hasToken flag).

  Token banane ke liye: Business Settings -> System Users -> Generate Token
  Permissions: ads_read (dekhne) + ads_management (edit) + read_insights
*/

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const SETTING_KEY = "meta-ads";

/*
  MULTI-ACCOUNT: ab config me accounts ki list hoti hai:
    { accounts: [{ adAccountId, accessToken, label }], activeId }
  Purana single-account data mile to khud migrate ho jata hai.
  Saare read/edit endpoints hamesha ACTIVE account use karte hain.
*/
async function getConfig() {
  let setting = await Setting.findOne({ key: SETTING_KEY });
  if (!setting) {
    setting = await Setting.create({ key: SETTING_KEY, data: { accounts: [], activeId: "" } });
  }
  const raw = setting.data || {};
  let accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  // Purana shape { adAccountId, accessToken } -> migrate
  if (!accounts.length && raw.adAccountId && raw.accessToken) {
    accounts = [{ adAccountId: raw.adAccountId, accessToken: raw.accessToken, label: "Account 1" }];
  }
  let activeId = raw.activeId;
  if (!activeId || !accounts.find((a) => a.adAccountId === activeId)) {
    activeId = accounts.length ? accounts[0].adAccountId : "";
  }
  const active = accounts.find((a) => a.adAccountId === activeId) || null;
  return {
    accounts,
    activeId,
    adAccountId: active ? active.adAccountId : "",
    accessToken: active ? active.accessToken : "",
    businessId: active ? active.businessId || "" : "",
    catalogIds: active && Array.isArray(active.catalogIds) ? active.catalogIds : [],
    enabled: Boolean(active),
  };
}

async function saveAccounts(accounts, activeId) {
  await Setting.findOneAndUpdate(
    { key: SETTING_KEY },
    { $set: { key: SETTING_KEY, data: { accounts, activeId } } },
    { upsert: true, new: true }
  );
}

// Frontend ko bhejne wala safe shape (tokens kabhi nahi jaate)
function publicConfig(cfg) {
  return {
    accounts: cfg.accounts.map((a) => ({
      adAccountId: a.adAccountId,
      label: a.label || a.adAccountId,
    })),
    activeId: cfg.activeId,
    adAccountId: cfg.adAccountId,
    enabled: cfg.enabled,
    hasToken: Boolean(cfg.accessToken),
  };
}

// Meta ki galti ko saaf message me badalta hai
function metaError(err) {
  const m = err?.response?.data?.error?.message;
  if (m) return m;
  return err?.message || "Meta API error";
}

// actions[] array me se ek action ki value nikalta hai
function pickAction(actions, types) {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

function pickRoas(row) {
  const r = row?.purchase_roas;
  if (Array.isArray(r) && r.length) return Number(r[0].value) || 0;
  return 0;
}

// insights row -> saaf numbers
function shapeInsights(row) {
  if (!row) {
    return {
      spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, cpm: 0,
      reach: 0, frequency: 0, roas: 0,
      purchases: 0, purchaseValue: 0, addToCart: 0, checkout: 0, landingPageViews: 0,
    };
  }
  const actions = row.actions || [];
  const values = row.action_values || [];
  return {
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.cpc) || 0,
    cpm: Number(row.cpm) || 0,
    reach: Number(row.reach) || 0,
    frequency: Number(row.frequency) || 0,
    roas: pickRoas(row),
    purchases: pickAction(actions, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    purchaseValue: pickAction(values, ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    addToCart: pickAction(actions, ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
    checkout: pickAction(actions, ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]),
    landingPageViews: pickAction(actions, ["landing_page_view", "omni_landing_page_view"]),
  };
}

const INSIGHT_FIELDS =
  "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,purchase_roas";

const VALID_PRESETS = [
  "today", "yesterday", "last_7d", "last_14d", "last_30d",
  "last_90d", "this_month", "last_month", "maximum",
];

function safePreset(p) {
  return VALID_PRESETS.includes(p) ? p : "last_30d";
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function presetRanges(preset) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let days = 30;
  if (preset === "today" || preset === "yesterday") days = 1;
  else if (preset === "last_7d") days = 7;
  else if (preset === "last_14d") days = 14;
  else if (preset === "last_90d") days = 90;
  else if (preset === "this_month") days = end.getUTCDate();
  else if (preset === "last_month") {
    const lastMonthEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
    const lastMonthStart = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));
    const priorEnd = new Date(lastMonthStart);
    priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
    const priorStart = new Date(Date.UTC(priorEnd.getUTCFullYear(), priorEnd.getUTCMonth(), 1));
    return {
      current: { since: isoDate(lastMonthStart), until: isoDate(lastMonthEnd) },
      previous: { since: isoDate(priorStart), until: isoDate(priorEnd) },
    };
  } else if (preset === "maximum") {
    return null;
  }

  let currentEnd = new Date(end);
  if (preset === "yesterday") currentEnd.setUTCDate(currentEnd.getUTCDate() - 1);
  const currentStart = new Date(currentEnd);
  currentStart.setUTCDate(currentStart.getUTCDate() - days + 1);
  const previousEnd = new Date(currentStart);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return {
    current: { since: isoDate(currentStart), until: isoDate(currentEnd) },
    previous: { since: isoDate(previousStart), until: isoDate(previousEnd) },
  };
}

function changePercent(current, previous) {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (!b) return a ? 100 : 0;
  return Number((((a - b) / Math.abs(b)) * 100).toFixed(1));
}

function compareInsights(current, previous) {
  const out = {};
  for (const key of ["spend", "impressions", "clicks", "ctr", "cpc", "cpm", "reach", "frequency", "roas", "purchases", "purchaseValue", "addToCart", "checkout", "landingPageViews"]) {
    out[key] = changePercent(current[key], previous[key]);
  }
  return out;
}

function parseJsonObject(text) {
  const clean = String(text || "").replace(/```json|```/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI response JSON format me nahi aaya");
  return JSON.parse(clean.slice(start, end + 1));
}

/* ============ CONFIG ============ */

// Frontend ko batata hai ki kaunse accounts jude hain (token kabhi nahi bhejte)
router.get("/config", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    res.json(publicConfig(cfg));
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// Account jodo ya update karo (naya ho to list me add, purana ho to token/label update)
router.put("/config", adminProtect, isAdmin, async (req, res) => {
  try {
    const { adAccountId, accessToken, label } = req.body;
    const cleanAcc = String(adAccountId || "").replace(/[^0-9]/g, "").trim();
    if (!cleanAcc) return res.status(400).json({ message: "Ad Account ID do" });

    const cfg = await getConfig();
    const accounts = [...cfg.accounts];
    const idx = accounts.findIndex((a) => a.adAccountId === cleanAcc);
    const newToken = accessToken && accessToken.trim() ? accessToken.trim() : "";

    if (idx >= 0) {
      // Update: token blank ho to purana hi rakho
      accounts[idx] = {
        ...accounts[idx],
        accessToken: newToken || accounts[idx].accessToken,
        label: label && label.trim() ? label.trim() : accounts[idx].label,
      };
    } else {
      if (!newToken) return res.status(400).json({ message: "Naye account ke liye token zaroori hai" });
      accounts.push({
        adAccountId: cleanAcc,
        accessToken: newToken,
        label: label && label.trim() ? label.trim() : `Account ${accounts.length + 1}`,
      });
    }
    // Jo account abhi save kiya wahi active bana do
    await saveAccounts(accounts, cleanAcc);
    res.json(publicConfig(await getConfig()));
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// Active account switch karo
router.post("/switch", adminProtect, isAdmin, async (req, res) => {
  try {
    const { adAccountId } = req.body;
    const cfg = await getConfig();
    if (!cfg.accounts.find((a) => a.adAccountId === adAccountId)) {
      return res.status(400).json({ message: "Ye account list me nahi hai" });
    }
    await saveAccounts(cfg.accounts, adAccountId);
    res.json(publicConfig(await getConfig()));
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// Account list se hatao (Meta pe kuch delete nahi hota, sirf panel se)
router.delete("/account/:adAccountId", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    const accounts = cfg.accounts.filter((a) => a.adAccountId !== req.params.adAccountId);
    const activeId = cfg.activeId === req.params.adAccountId
      ? (accounts[0]?.adAccountId || "")
      : cfg.activeId;
    await saveAccounts(accounts, activeId);
    res.json(publicConfig(await getConfig()));
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// Token + account sahi hai ya nahi test karta hai
router.get("/test", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ ok: false, message: "Token ya Ad Account ID missing hai" });
    }
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}`, {
      params: { fields: "name,currency,account_status", access_token: cfg.accessToken },
    });
    res.json({ ok: true, account: data });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/* ============ READ: OVERVIEW ============ */

router.get("/overview", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua. Pehle token save karo." });
    }
    const preset = safePreset(req.query.datePreset);
    const ACT = `act_${cfg.adAccountId}`;
    const ranges = presetRanges(preset);
    const insightParams = ranges
      ? { fields: INSIGHT_FIELDS, time_ranges: JSON.stringify([ranges.current, ranges.previous]), access_token: cfg.accessToken }
      : { fields: INSIGHT_FIELDS, date_preset: preset, access_token: cfg.accessToken };
    const [insightsR, accountR] = await Promise.all([
      axios.get(`${GRAPH}/${ACT}/insights`, { params: insightParams }),
      axios.get(`${GRAPH}/${ACT}`, {
        params: {
          fields: "id,name,currency,timezone_name,account_status,disable_reason,amount_spent,balance,spend_cap,business{id,name}",
          access_token: cfg.accessToken,
        },
      }),
    ]);
    const rows = insightsR.data.data || [];
    const current = shapeInsights(rows[0]);
    const previous = ranges ? shapeInsights(rows[1]) : null;
    const account = accountR.data || {};
    const anomalies = [];
    if (current.addToCart > current.landingPageViews && current.landingPageViews > 0) {
      anomalies.push({
        code: "ATC_OVER_LPV",
        severity: "warning",
        message: `Add to cart (${current.addToCart}) landing page views (${current.landingPageViews}) se zyada hai. Pixel/CAPI deduplication check karo.`,
      });
    }
    if (current.clicks > 0 && current.landingPageViews / current.clicks < 0.65) {
      anomalies.push({
        code: "LOW_LPV_RATE",
        severity: "warning",
        message: `Sirf ${Math.round((current.landingPageViews / current.clicks) * 100)}% clicks landing page tak pahuche. Website speed ya accidental clicks check karo.`,
      });
    }
    res.json({
      datePreset: preset,
      currency: account.currency || "INR",
      ...current,
      previous,
      comparison: previous ? compareInsights(current, previous) : null,
      range: ranges?.current || null,
      syncedAt: new Date().toISOString(),
      graphVersion: META_GRAPH_VERSION,
      account: {
        id: account.id,
        name: account.name,
        currency: account.currency || "INR",
        timezone: account.timezone_name,
        status: account.account_status,
        disableReason: account.disable_reason || 0,
        amountSpent: Number(account.amount_spent || 0) / 100,
        balance: Number(account.balance || 0) / 100,
        spendCap: Number(account.spend_cap || 0) / 100,
        business: account.business || null,
      },
      anomalies,
    });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

/* ============ READ: CAMPAIGNS ============ */

router.get("/campaigns", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua. Pehle token save karo." });
    }
    const preset = safePreset(req.query.datePreset);
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/campaigns`, {
      params: {
        fields: `name,status,configured_status,effective_status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,bid_strategy,special_ad_categories,start_time,stop_time,created_time,updated_time,issues_info,insights.date_preset(${preset}){${INSIGHT_FIELDS}}`,
        limit: 200,
        access_token: cfg.accessToken,
      },
    });
    const campaigns = (data.data || []).map((c) => {
      const row = c.insights && c.insights.data && c.insights.data[0];
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        configuredStatus: c.configured_status,
        effectiveStatus: c.effective_status,
        objective: c.objective,
        buyingType: c.buying_type || null,
        dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        budgetRemaining: c.budget_remaining ? Number(c.budget_remaining) / 100 : null,
        bidStrategy: c.bid_strategy || null,
        specialAdCategories: c.special_ad_categories || [],
        startTime: c.start_time || null,
        stopTime: c.stop_time || null,
        createdTime: c.created_time || null,
        updatedTime: c.updated_time || null,
        issues: c.issues_info || [],
        insights: shapeInsights(row),
      };
    });
    res.json({ datePreset: preset, campaigns });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

/* ============ READ: ADS (ad-level, campaign ke andar ke ads) ============ */

router.get("/ads", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua" });
    }
    const preset = safePreset(req.query.datePreset);
    const base = req.query.campaignId
      ? `${GRAPH}/${req.query.campaignId}/ads`
      : `${GRAPH}/act_${cfg.adAccountId}/ads`;
    const { data } = await axios.get(base, {
      params: {
        fields: `name,status,configured_status,effective_status,created_time,updated_time,conversion_domain,tracking_specs,adset{id,name,status,configured_status,effective_status,daily_budget,lifetime_budget,budget_remaining,optimization_goal,bid_strategy,bid_amount,billing_event,start_time,end_time,targeting,promoted_object,attribution_spec,destination_type,created_time,updated_time},creative{id,name,thumbnail_url,effective_object_story_id,object_story_spec,asset_feed_spec,instagram_permalink_url},insights.date_preset(${preset}){${INSIGHT_FIELDS}}`,
        limit: 100,
        access_token: cfg.accessToken,
      },
    });
    const ads = (data.data || []).map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      configuredStatus: a.configured_status,
      effectiveStatus: a.effective_status,
      createdTime: a.created_time || null,
      updatedTime: a.updated_time || null,
      conversionDomain: a.conversion_domain || null,
      trackingSpecs: a.tracking_specs || [],
      adsetId: a.adset?.id || a.adset_id,
      adset: a.adset ? {
        id: a.adset.id,
        name: a.adset.name,
        status: a.adset.status,
        configuredStatus: a.adset.configured_status,
        effectiveStatus: a.adset.effective_status,
        dailyBudget: a.adset.daily_budget ? Number(a.adset.daily_budget) / 100 : null,
        lifetimeBudget: a.adset.lifetime_budget ? Number(a.adset.lifetime_budget) / 100 : null,
        budgetRemaining: a.adset.budget_remaining ? Number(a.adset.budget_remaining) / 100 : null,
        optimizationGoal: a.adset.optimization_goal,
        bidStrategy: a.adset.bid_strategy,
        bidAmount: a.adset.bid_amount ? Number(a.adset.bid_amount) / 100 : null,
        billingEvent: a.adset.billing_event || null,
        startTime: a.adset.start_time || null,
        endTime: a.adset.end_time || null,
        targeting: a.adset.targeting || null,
        promotedObject: a.adset.promoted_object || null,
        attributionSpec: a.adset.attribution_spec || [],
        destinationType: a.adset.destination_type || null,
        createdTime: a.adset.created_time || null,
        updatedTime: a.adset.updated_time || null,
      } : null,
      creative: a.creative ? {
        id: a.creative.id,
        name: a.creative.name,
        thumbnail: a.creative.thumbnail_url || null,
        effectiveObjectStoryId: a.creative.effective_object_story_id || null,
        objectStorySpec: a.creative.object_story_spec || null,
        assetFeedSpec: a.creative.asset_feed_spec || null,
        instagramPermalinkUrl: a.creative.instagram_permalink_url || null,
      } : null,
      insights: shapeInsights(a.insights && a.insights.data && a.insights.data[0]),
    }));
    res.json({ datePreset: preset, ads });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

/* ============ READ: DAILY TREND (graph ke liye) ============ */

router.get("/trend", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua" });
    }
    const preset = safePreset(req.query.datePreset);
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/insights`, {
      params: {
        fields: "spend,clicks,actions,action_values",
        date_preset: preset,
        time_increment: 1,
        limit: 200,
        access_token: cfg.accessToken,
      },
    });
    const days = (data.data || []).map((row) => ({
      date: row.date_start,
      spend: Number(row.spend) || 0,
      clicks: Number(row.clicks) || 0,
      purchases: pickAction(row.actions || [], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
      purchaseValue: pickAction(row.action_values || [], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
    }));
    res.json({ datePreset: preset, days });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

/* ============ READ: BREAKDOWN (age / gender / platform / region) ============ */

const BREAKDOWN_MAP = {
  age: "age",
  gender: "gender",
  platform: "publisher_platform",
  placement: "platform_position",
  region: "region",
  device: "impression_device",
};

router.get("/breakdown", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua" });
    }
    const preset = safePreset(req.query.datePreset);
    const bd = BREAKDOWN_MAP[req.query.type] || "age";
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/insights`, {
      params: {
        fields: "spend,impressions,clicks,ctr,actions,action_values",
        date_preset: preset,
        breakdowns: bd,
        limit: 100,
        access_token: cfg.accessToken,
      },
    });
    const rows = (data.data || [])
      .map((row) => ({
        key: row[bd] || "unknown",
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        ctr: Number(row.ctr) || 0,
        purchases: pickAction(row.actions || [], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
        purchaseValue: pickAction(row.action_values || [], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
      }))
      .sort((a, b) => b.spend - a.spend);
    res.json({ datePreset: preset, type: req.query.type || "age", rows });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

/* ============ REAL TARGETING SEARCH + AUDIENCE TOOLS ============ */

const TARGETING_SEARCH_TYPES = {
  interest: "adinterest",
  job_title: "adworkposition",
  employer: "adworkemployer",
  city: "adgeolocation",
  region: "adgeolocation",
};

async function searchTargeting(cfg, kind, query, limit = 12) {
  const type = TARGETING_SEARCH_TYPES[kind];
  if (!type) return [];
  const params = {
    type,
    q: String(query || "").trim(),
    limit: Math.min(Math.max(Number(limit) || 12, 1), 50),
    access_token: cfg.accessToken,
  };
  if (kind === "city" || kind === "region") {
    params.location_types = JSON.stringify([kind]);
    params.country_code = "IN";
  }
  const { data } = await axios.get(`${GRAPH}/search`, { params });
  return (data.data || []).map((row) => ({
    id: String(row.id || row.key),
    key: String(row.key || row.id),
    name: row.name,
    type: kind,
    path: row.path || [],
    countryCode: row.country_code || null,
    region: row.region || null,
    audienceLower: Number(row.audience_size_lower_bound || row.audience_size || 0),
    audienceUpper: Number(row.audience_size_upper_bound || row.audience_size || 0),
  }));
}

router.get("/targeting-search", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });
    const kind = String(req.query.kind || "interest");
    const query = String(req.query.q || "").trim();
    if (!query || query.length < 2) return res.json({ results: [] });
    const results = await searchTargeting(cfg, kind, query, req.query.limit);
    res.json({ kind, query, source: "Meta Targeting Search", results });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

router.get("/custom-audiences", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) return res.status(400).json({ message: "Config missing" });
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/customaudiences`, {
      params: {
        fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status",
        limit: 200,
        access_token: cfg.accessToken,
      },
    });
    res.json({
      audiences: (data.data || []).map((a) => ({
        id: a.id,
        name: a.name,
        subtype: a.subtype,
        lower: Number(a.approximate_count_lower_bound || 0),
        upper: Number(a.approximate_count_upper_bound || 0),
        deliveryStatus: a.delivery_status || null,
        operationStatus: a.operation_status || null,
      })),
    });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

function buildTargeting(input = {}) {
  const countries = Array.isArray(input.countries) && input.countries.length ? input.countries : ["IN"];
  const geo = { countries };
  if (Array.isArray(input.cities) && input.cities.length) {
    geo.cities = input.cities.map((x) => ({ key: String(x.key || x.id), radius: Number(x.radius) || 25, distance_unit: "kilometer" }));
    delete geo.countries;
  }
  if (Array.isArray(input.regions) && input.regions.length) {
    geo.regions = input.regions.map((x) => ({ key: String(x.key || x.id) }));
    delete geo.countries;
  }
  const targeting = {
    geo_locations: geo,
    age_min: Math.max(18, Number(input.ageMin) || 18),
    age_max: Math.min(65, Number(input.ageMax) || 65),
    targeting_automation: { advantage_audience: input.advantageAudience ? 1 : 0 },
  };
  if (input.genders === "male") targeting.genders = [1];
  if (input.genders === "female") targeting.genders = [2];
  if (Array.isArray(input.includeAudienceIds) && input.includeAudienceIds.length) {
    targeting.custom_audiences = input.includeAudienceIds.map((id) => ({ id }));
  }
  if (Array.isArray(input.excludeAudienceIds) && input.excludeAudienceIds.length) {
    targeting.excluded_custom_audiences = input.excludeAudienceIds.map((id) => ({ id }));
  }
  const detailGroup = {};
  if (Array.isArray(input.interests) && input.interests.length) {
    detailGroup.interests = input.interests.map((x) => ({ id: String(x.id), name: x.name }));
  }
  if (Array.isArray(input.jobTitles) && input.jobTitles.length) {
    detailGroup.work_positions = input.jobTitles.map((x) => ({ id: String(x.id), name: x.name }));
  }
  const flexibleSpec = [];
  if (Object.keys(detailGroup).length) flexibleSpec.push(detailGroup);
  const narrowGroup = {};
  if (Array.isArray(input.narrowInterests) && input.narrowInterests.length) {
    narrowGroup.interests = input.narrowInterests.map((x) => ({ id: String(x.id), name: x.name }));
  }
  if (Array.isArray(input.narrowJobTitles) && input.narrowJobTitles.length) {
    narrowGroup.work_positions = input.narrowJobTitles.map((x) => ({ id: String(x.id), name: x.name }));
  }
  if (Object.keys(narrowGroup).length) flexibleSpec.push(narrowGroup);
  if (flexibleSpec.length) targeting.flexible_spec = flexibleSpec;

  const exclusions = {};
  if (Array.isArray(input.excludeInterests) && input.excludeInterests.length) {
    exclusions.interests = input.excludeInterests.map((x) => ({ id: String(x.id), name: x.name }));
  }
  if (Array.isArray(input.excludeJobTitles) && input.excludeJobTitles.length) {
    exclusions.work_positions = input.excludeJobTitles.map((x) => ({ id: String(x.id), name: x.name }));
  }
  if (Object.keys(exclusions).length) targeting.exclusions = exclusions;

  if (Array.isArray(input.platforms) && input.platforms.length) targeting.publisher_platforms = input.platforms;
  const positions = Array.isArray(input.placementPositions) ? input.placementPositions : [];
  const fb = positions.filter((x) => ["feed", "marketplace", "video_feeds", "right_hand_column"].includes(x));
  const ig = positions.filter((x) => ["stream", "story", "reels", "explore"].includes(x));
  if (fb.length) targeting.facebook_positions = fb;
  if (ig.length) targeting.instagram_positions = ig;
  if (Array.isArray(input.devicePlatforms) && input.devicePlatforms.length) {
    targeting.device_platforms = input.devicePlatforms;
  }
  return targeting;
}

router.post("/audience-estimate", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) return res.status(400).json({ message: "Config missing" });
    const targeting = buildTargeting(req.body || {});
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/delivery_estimate`, {
      params: {
        targeting_spec: JSON.stringify(targeting),
        optimization_goal: req.body.optimizationGoal || "OFFSITE_CONVERSIONS",
        access_token: cfg.accessToken,
      },
    });
    const estimate = (data.data || [])[0] || {};
    res.json({
      source: "Meta Delivery Estimate",
      ready: Boolean(estimate.estimate_ready),
      dailyReachLower: Number(estimate.estimate_dau_lower_bound || 0),
      dailyReachUpper: Number(estimate.estimate_dau_upper_bound || 0),
      audienceLower: Number(estimate.estimate_mau_lower_bound || 0),
      audienceUpper: Number(estimate.estimate_mau_upper_bound || 0),
    });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

router.post("/ai-b2b-plan", adminProtect, isAdmin, async (req, res) => {
  try {
    const key = getGeminiKey();
    if (!key) return res.status(400).json({ message: "GEMINI_API_KEY .env me nahi mili" });
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) return res.status(400).json({ message: "Meta Ads configure nahi hua" });
    const {
      businessType = "B2B wholesale toys supplier",
      offer = "Wholesale toys at factory prices",
      goal = "Qualified retailer and distributor leads",
      website = "https://bafnatoys.com",
      targetLocations = "India",
      language = "Hinglish",
    } = req.body || {};

    const [insightsR, ageR, regionR] = await Promise.allSettled([
      axios.get(`${GRAPH}/act_${cfg.adAccountId}/insights`, {
        params: { fields: INSIGHT_FIELDS, date_preset: "last_90d", access_token: cfg.accessToken },
      }),
      axios.get(`${GRAPH}/act_${cfg.adAccountId}/insights`, {
        params: { fields: "spend,clicks,ctr,actions", date_preset: "last_90d", breakdowns: "age", access_token: cfg.accessToken },
      }),
      axios.get(`${GRAPH}/act_${cfg.adAccountId}/insights`, {
        params: { fields: "spend,clicks,ctr,actions", date_preset: "last_90d", breakdowns: "region", limit: 30, access_token: cfg.accessToken },
      }),
    ]);
    const realSignals = {
      overview: insightsR.status === "fulfilled" ? shapeInsights(insightsR.value.data.data?.[0]) : null,
      age: ageR.status === "fulfilled" ? ageR.value.data.data || [] : [],
      regions: regionR.status === "fulfilled" ? regionR.value.data.data || [] : [],
    };

    const prompt = `You are a senior Meta Ads strategist for an Indian B2B company. Create a practical campaign plan using the business context and the REAL last-90-day Meta performance supplied below. Do not invent performance numbers. Return ONLY valid JSON with this exact shape:
{
  "strategySummary":"string",
  "recommendedObjective":"LEADS or SALES or TRAFFIC",
  "recommendedAgeMin":number,
  "recommendedAgeMax":number,
  "recommendedBudget":number,
  "optimizationGoal":"OFFSITE_CONVERSIONS or LANDING_PAGE_VIEWS or LINK_CLICKS",
  "interestKeywords":["max 6 searchable Meta interest names"],
  "jobTitleKeywords":["max 6 B2B decision maker job titles"],
  "primaryTexts":["3 ad primary text variants, max 350 chars each"],
  "headlines":["5 headlines, max 40 chars each"],
  "descriptions":["3 descriptions, max 60 chars each"],
  "recommendedCta":"CONTACT_US or LEARN_MORE or GET_OFFER or SHOP_NOW",
  "whyThisAudience":["3 concise reasons"],
  "trackingChecklist":["4 concise checks"]
}
Business: ${businessType}
Offer: ${offer}
Goal: ${goal}
Website: ${website}
Locations: ${targetLocations}
Copy language: ${language}
Real Meta data: ${JSON.stringify(realSignals)}`;
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const gr = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.45 },
      },
      { headers: { "Content-Type": "application/json" }, timeout: 60000 }
    );
    const plan = parseJsonObject(gr.data?.candidates?.[0]?.content?.parts?.[0]?.text);
    const interestTerms = (plan.interestKeywords || []).slice(0, 6);
    const jobTerms = (plan.jobTitleKeywords || []).slice(0, 6);
    const [interestSearches, jobSearches] = await Promise.all([
      Promise.allSettled(interestTerms.map((q) => searchTargeting(cfg, "interest", q, 3))),
      Promise.allSettled(jobTerms.map((q) => searchTargeting(cfg, "job_title", q, 3))),
    ]);
    const unique = (rows) => {
      const map = new Map();
      for (const r of rows) if (r?.id && !map.has(r.id)) map.set(r.id, r);
      return [...map.values()];
    };
    const interests = unique(interestSearches.flatMap((r) => r.status === "fulfilled" ? r.value.slice(0, 1) : []));
    const jobTitles = unique(jobSearches.flatMap((r) => r.status === "fulfilled" ? r.value.slice(0, 1) : []));
    res.json({
      ok: true,
      source: { analysis: `Gemini ${model}`, targeting: "Meta Targeting Search", performanceWindow: "last_90d" },
      plan: { ...plan, interests, jobTitles },
    });
  } catch (err) {
    res.status(400).json({ message: err?.response?.data?.error?.message || metaError(err) });
  }
});

/* ============ RETARGETING: pixel audiences bana do / dhoondh lo ============ */
/*
  Do audiences banti hain (agar pehle se nahi hain):
    - "BT — Cart 30d"       : jinhone 30 din me Add To Cart kiya
    - "BT — Purchasers 30d" : jinhone 30 din me kharida (ad me exclude karenge)
  Retargeting ad = Cart wale INCLUDE, Purchasers EXCLUDE.
*/
router.post("/ensure-retargeting", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua" });
    }
    const T = cfg.accessToken;
    const ACT = `act_${cfg.adAccountId}`;

    // Pixel chahiye
    const px = await axios.get(`${GRAPH}/${ACT}/adspixels`, {
      params: { fields: "id,name", access_token: T },
    });
    const pixel = (px.data.data || [])[0];
    if (!pixel) return res.status(400).json({ message: "Is account me koi Pixel nahi mila" });

    // Pehle se bani audiences check karo
    const existing = await axios.get(`${GRAPH}/${ACT}/customaudiences`, {
      params: { fields: "id,name", limit: 200, access_token: T },
    });
    const list = existing.data.data || [];
    const findByName = (n) => list.find((a) => a.name === n);

    async function ensureAudience(name, eventName) {
      const found = findByName(name);
      if (found) return found.id;
      const rule = {
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ id: pixel.id, type: "pixel" }],
              retention_seconds: 30 * 24 * 60 * 60,
              filter: {
                operator: "and",
                filters: [{ field: "event", operator: "eq", value: eventName }],
              },
            },
          ],
        },
      };
      const created = await axios.post(`${GRAPH}/${ACT}/customaudiences`, null, {
        params: {
          name,
          rule: JSON.stringify(rule),
          prefill: true,
          access_token: T,
        },
      });
      return created.data.id;
    }

    const atcId = await ensureAudience("BT — Cart 30d", "AddToCart");
    const buyerId = await ensureAudience("BT — Purchasers 30d", "Purchase");

    res.json({ ok: true, pixelId: pixel.id, atcAudienceId: atcId, purchaserAudienceId: buyerId });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/* ============ CREATE AD: HELPERS ============ */

// Pages jo is token se accessible hain (ad kis page ke naam se chalega)
router.get("/pages", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });
    const { data } = await axios.get(`${GRAPH}/me/accounts`, {
      params: {
        fields: "id,name,picture{url},instagram_business_account{id,username,profile_picture_url}",
        limit: 100,
        access_token: cfg.accessToken,
      },
    });
    const pages = (data.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      picture: p.picture?.data?.url || null,
      instagramAccount: p.instagram_business_account
        ? {
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username || "",
            picture: p.instagram_business_account.profile_picture_url || null,
          }
        : null,
    }));
    res.json({ pages });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

// Ad account ke pixels (Sales objective ke liye zaroori)
router.get("/pixels", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Config missing" });
    }
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/adspixels`, {
      params: { fields: "id,name", access_token: cfg.accessToken },
    });
    res.json({ pixels: data.data || [] });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

// Catalogs + unke product sets (Catalog ads ke liye)
router.get("/catalogs", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });
    const T = cfg.accessToken;

    // System user pe /me/businesses khali aata hai — isliye:
    // 1) account config me saved businessId, 2) ad account ki owning business,
    // 3) /me/businesses — teeno jagah se dhoondte hain
    let businesses = [];
    if (cfg.businessId) {
      businesses.push({ id: cfg.businessId, name: "Business" });
    }
    try {
      const acc = await axios.get(`${GRAPH}/act_${cfg.adAccountId}`, {
        params: { fields: "business{id,name}", access_token: T },
      });
      if (acc.data.business) businesses.push(acc.data.business);
    } catch {}
    try {
      const biz = await axios.get(`${GRAPH}/me/businesses`, {
        params: { fields: "id,name", limit: 50, access_token: T },
      });
      for (const b of biz.data.data || []) {
        if (!businesses.find((x) => x.id === b.id)) businesses.push(b);
      }
    } catch {}

    const catalogMap = new Map();
    const remember = (rows, businessName) => {
      for (const c of rows || []) {
        if (!c?.id) continue;
        const old = catalogMap.get(c.id);
        catalogMap.set(c.id, {
          ...(old || {}),
          ...c,
          businessName: c.business?.name || businessName || old?.businessName || "Meta Business",
        });
      }
    };

    for (const catalogId of cfg.catalogIds || []) {
      try {
        const explicit = await axios.get(`${GRAPH}/${catalogId}`, {
          params: { fields: "id,name,product_count,vertical,business{id,name}", access_token: T },
        });
        remember([explicit.data], "Connected catalog");
      } catch {}
    }

    // Ad account se directly assigned catalogs. System-user tokens me ye
    // business discovery se zyada reliable hota hai.
    try {
      const direct = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/product_catalogs`, {
        params: { fields: "id,name,product_count,vertical,business{id,name}", limit: 100, access_token: T },
      });
      remember(direct.data.data, "Assigned to ad account");
    } catch {}

    for (const b of businesses) {
      for (const edge of ["owned_product_catalogs", "client_product_catalogs"]) {
        try {
          const cats = await axios.get(`${GRAPH}/${b.id}/${edge}`, {
            params: { fields: "id,name,product_count,vertical,business{id,name}", limit: 100, access_token: T },
          });
          remember(cats.data.data, b.name);
        } catch {}
      }
    }

    const catalogs = [];
    for (const c of catalogMap.values()) {
      let productSets = [];
      try {
        const ps = await axios.get(`${GRAPH}/${c.id}/product_sets`, {
          params: { fields: "id,name,product_count,filter", limit: 200, access_token: T },
        });
        productSets = (ps.data.data || []).map((s) => ({
          id: s.id,
          name: s.name,
          count: Number(s.product_count || 0),
          filter: s.filter || null,
        }));
      } catch {}

      catalogs.push({
        id: c.id,
        name: c.name,
        business: c.businessName,
        vertical: c.vertical || "commerce",
        productCount: Number(c.product_count || 0),
        productSets: productSets.sort((a, b) => b.count - a.count),
      });
    }
    res.json({ catalogs, source: "Meta Catalog API" });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

router.post("/catalog-connect", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.activeId) return res.status(400).json({ message: "Meta account config missing" });
    const catalogId = String(req.body.catalogId || "").replace(/[^0-9]/g, "");
    if (!catalogId) return res.status(400).json({ message: "Valid Catalog ID daalo" });
    const { data } = await axios.get(`${GRAPH}/${catalogId}`, {
      params: { fields: "id,name,product_count,vertical,business{id,name}", access_token: cfg.accessToken },
    });
    const accounts = cfg.accounts.map((a) => {
      if (a.adAccountId !== cfg.activeId) return a;
      return { ...a, catalogIds: [...new Set([...(a.catalogIds || []), catalogId])] };
    });
    await saveAccounts(accounts, cfg.activeId);
    res.json({
      ok: true,
      catalog: {
        id: data.id,
        name: data.name,
        productCount: Number(data.product_count || 0),
        business: data.business?.name || "Connected catalog",
      },
    });
  } catch (err) {
    res.status(400).json({
      message: `${metaError(err)}. System user ko catalog asset aur catalog_management permission assign karo.`,
    });
  }
});

// Product set ke andar ke products (preview ke liye)
router.get("/catalog-products", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });
    const { productSetId } = req.query;
    if (!productSetId) return res.status(400).json({ message: "productSetId do" });
    const { data } = await axios.get(`${GRAPH}/${productSetId}/products`, {
      params: {
        fields: "id,name,image_url,price,availability",
        limit: 12,
        access_token: cfg.accessToken,
      },
    });
    res.json({
      products: (data.data || []).map((p) => ({
        id: p.id,
        name: p.name,
        image: p.image_url || null,
        price: p.price || "",
        availability: p.availability || "",
      })),
    });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

// Naya product set banao (catalog ke andar)
router.post("/catalog-set", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });
    const { catalogId, name, keyword } = req.body;
    if (!catalogId || !name) {
      return res.status(400).json({ message: "catalogId aur name do" });
    }
    // keyword diya to us naam wale products, warna saare products
    const filter = { name: { i_contains: String(keyword || "").trim() } };
    const { data } = await axios.post(`${GRAPH}/${catalogId}/product_sets`, null, {
      params: {
        name: String(name).trim(),
        filter: JSON.stringify(filter),
        access_token: cfg.accessToken,
      },
    });
    res.json({ ok: true, id: data.id, name: String(name).trim() });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

// Page ke recent posts (existing post boost karne ke liye)
router.get("/page-posts", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });
    const { pageId } = req.query;
    if (!pageId) return res.status(400).json({ message: "pageId do" });

    // Page ka apna token chahiye posts padhne ke liye
    const pg = await axios.get(`${GRAPH}/me/accounts`, {
      params: { fields: "id,name,access_token", limit: 100, access_token: cfg.accessToken },
    });
    const page = (pg.data.data || []).find((p) => p.id === pageId);
    if (!page?.access_token) {
      return res.status(400).json({ message: "Is page ka access token nahi mila" });
    }
    const posts = await axios.get(`${GRAPH}/${pageId}/published_posts`, {
      params: {
        fields: "id,message,full_picture,created_time,permalink_url",
        limit: 24,
        access_token: page.access_token,
      },
    });
    res.json({
      posts: (posts.data.data || [])
        .filter((p) => p.full_picture)
        .map((p) => ({
          id: p.id,
          message: (p.message || "").slice(0, 120),
          picture: p.full_picture,
          createdTime: p.created_time,
        })),
    });
  } catch (err) {
    res.status(400).json({ message: metaError(err) });
  }
});

// Image upload (base64) -> Meta ad image -> image_hash wapas milta hai
router.post("/upload-image", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Config missing" });
    }
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ message: "imageBase64 do" });
    // "data:image/png;base64,..." prefix hata do agar hai
    const clean = String(imageBase64).replace(/^data:image\/[a-zA-Z+]+;base64,/, "");

    const { data } = await axios.post(
      `${GRAPH}/act_${cfg.adAccountId}/adimages`,
      new URLSearchParams({ bytes: clean, access_token: cfg.accessToken }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, maxBodyLength: Infinity }
    );
    // Response shape: { images: { "<key>": { hash, url } } }
    const first = data.images && Object.values(data.images)[0];
    if (!first?.hash) return res.status(400).json({ message: "Image upload fail (hash nahi mila)" });
    res.json({ ok: true, hash: first.hash, url: first.url || null });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/* ============ CREATE AD: FULL WIZARD ============ */
/*
  Ek hi call me poora ad ban jaata hai (sab PAUSED me — paisa nahi lagta
  jab tak khud activate na karo):
    1. Campaign  (objective ke saath)
    2. Ad Set    (budget + targeting + optimization)
    3. Creative  (image + text + link + CTA)
    4. Ad        (sab jodkar)
  Agar beech me koi step fail ho jaye to jo ban chuka use delete kar dete
  hain taaki aadha-adhura kachra na bache.
*/
router.post("/create-ad", adminProtect, isAdmin, async (req, res) => {
  const cfg = await getConfig();
  if (!cfg.accessToken || !cfg.adAccountId) {
    return res.status(400).json({ message: "Meta Ads configure nahi hua" });
  }
  const T = cfg.accessToken;
  const ACT = `act_${cfg.adAccountId}`;

  const {
    name,            // campaign/ad ka naam
    objective,
    pageId,          // Facebook page id
    pixelId,         // SALES ke liye zaroori
    dailyBudget,     // rupees me
    ageMin, ageMax,  // targeting
    countries,       // ["IN"]
    imageHash,       // /upload-image se mila hash (image mode)
    primaryText,     // ad ka main text
    headline,        // bold heading
    description,     // chhota description
    link,            // website link
    cta,             // "SHOP_NOW" | "LEARN_MORE" | "ORDER_NOW" | "GET_OFFER"
    includeAudienceIds, // retargeting: in audiences ko dikhao
    excludeAudienceIds, // retargeting: in audiences ko mat dikhao
    productSetId,    // catalog mode: kaunsa product set dikhana hai
    instagramActorId,
    catalogFormat,
    catalogCustomCard,
    multiShareEndCard,
    showMultipleImages,
    additionalImageIndex,
    automatedProductTags,
    postId,          // post mode: existing page post boost karna
    genders,         // "all" | "male" | "female"
    platforms,       // ["facebook","instagram"] — khali/undefined = auto (sab jagah)
    placementPositions,
    devicePlatforms,
    interests,
    jobTitles,
    narrowInterests,
    narrowJobTitles,
    excludeInterests,
    excludeJobTitles,
    cities,
    regions,
    advantageAudience,
    optimizationGoal,
    conversionEvent,
    bidStrategy,
    costCap,
    attributionWindow,
    startTime,
    endTime,
    utmParameters,
  } = req.body;

  // Creative ka source: catalog > post > image
  const creativeMode = productSetId ? "catalog" : postId ? "post" : "image";

  // ---- Validation ----
  const rupees = Number(dailyBudget);
  if (!name || !pageId) {
    return res.status(400).json({ message: "name aur pageId zaroori hain" });
  }
  if (!rupees || rupees < 100) {
    return res.status(400).json({ message: "Daily budget kam se kam ₹100 rakho" });
  }
  if (creativeMode === "image" && (!imageHash || !link || !primaryText)) {
    return res.status(400).json({ message: "Image ad ke liye imageHash, link, primaryText zaroori hain" });
  }
  if (creativeMode === "catalog" && (!link || !primaryText)) {
    return res.status(400).json({ message: "Catalog ad ke liye link aur primaryText zaroori hain" });
  }
  if (creativeMode === "catalog" && catalogCustomCard?.enabled && !catalogCustomCard?.imageHash) {
    return res.status(400).json({ message: "Custom catalogue card ke liye image upload zaroori hai" });
  }
  const normalizedObjective = String(objective || "SALES").toUpperCase();
  const isSales = creativeMode === "catalog" || normalizedObjective === "SALES";
  const isWebsiteLead = normalizedObjective === "LEADS";
  if ((isSales || isWebsiteLead) && creativeMode !== "catalog" && !pixelId) {
    return res.status(400).json({ message: `${isWebsiteLead ? "Website leads" : "Sales"} objective ke liye Pixel zaroori hai` });
  }
  const validCta = ["SHOP_NOW", "LEARN_MORE", "ORDER_NOW", "GET_OFFER", "CONTACT_US"];
  const ctaType = validCta.includes(cta) ? cta : "SHOP_NOW";
  const objectiveMap = {
    SALES: "OUTCOME_SALES",
    LEADS: "OUTCOME_LEADS",
    TRAFFIC: "OUTCOME_TRAFFIC",
    AWARENESS: "OUTCOME_AWARENESS",
    ENGAGEMENT: "OUTCOME_ENGAGEMENT",
  };
  const campaignObjective = creativeMode === "catalog"
    ? "OUTCOME_SALES"
    : (objectiveMap[normalizedObjective] || "OUTCOME_TRAFFIC");
  const validOptimizationGoals = [
    "OFFSITE_CONVERSIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "REACH", "IMPRESSIONS",
  ];
  const defaultOptimization = (isSales || isWebsiteLead)
    ? "OFFSITE_CONVERSIONS"
    : normalizedObjective === "AWARENESS" ? "REACH" : "LANDING_PAGE_VIEWS";
  const chosenOptimization = validOptimizationGoals.includes(optimizationGoal)
    ? optimizationGoal
    : defaultOptimization;
  const finalLink = (() => {
    if (!utmParameters || creativeMode === "post") return link;
    try {
      const u = new URL(link);
      const params = typeof utmParameters === "string"
        ? new URLSearchParams(utmParameters.replace(/^\?/, ""))
        : new URLSearchParams(utmParameters);
      params.forEach((v, k) => u.searchParams.set(k, v));
      return u.toString();
    } catch {
      return link;
    }
  })();

  const created = { campaignId: null, adsetId: null, creativeId: null, adId: null };

  // Fail hone par jo ban gaya use hata do
  async function rollback() {
    for (const id of [created.adId, created.creativeId, created.adsetId, created.campaignId]) {
      if (id) {
        try { await axios.delete(`${GRAPH}/${id}`, { params: { access_token: T } }); } catch {}
      }
    }
  }

  try {
    // ---- 1. Campaign (PAUSED) ----
    const camp = await axios.post(`${GRAPH}/${ACT}/campaigns`, null, {
      params: {
        name,
        objective: campaignObjective,
        status: "PAUSED",
        special_ad_categories: JSON.stringify([]),
        access_token: T,
      },
    });
    created.campaignId = camp.data.id;

    // ---- 2. Ad Set (PAUSED, budget + targeting) ----
    let targeting = {
      geo_locations: { countries: Array.isArray(countries) && countries.length ? countries : ["IN"] },
      age_min: Math.max(18, Number(ageMin) || 18),
      age_max: Math.min(65, Number(ageMax) || 65),
      targeting_automation: { advantage_audience: 0 },
    };
    if (Array.isArray(includeAudienceIds) && includeAudienceIds.length) {
      targeting.custom_audiences = includeAudienceIds.map((id) => ({ id }));
    }
    if (Array.isArray(excludeAudienceIds) && excludeAudienceIds.length) {
      targeting.excluded_custom_audiences = excludeAudienceIds.map((id) => ({ id }));
    }
    // Gender: all = dono, male = [1], female = [2]
    if (genders === "male") targeting.genders = [1];
    if (genders === "female") targeting.genders = [2];
    // Placement: agar manual platforms diye to wahi, warna Meta auto (Advantage+)
    if (Array.isArray(platforms) && platforms.length) {
      targeting.publisher_platforms = platforms;
    }
    targeting = buildTargeting({
      countries, ageMin, ageMax, includeAudienceIds, excludeAudienceIds,
      genders, platforms, placementPositions, devicePlatforms, interests,
      jobTitles, narrowInterests, narrowJobTitles, excludeInterests,
      excludeJobTitles, cities, regions, advantageAudience,
    });
    const normalizedBidStrategy = bidStrategy === "COST_CAP" ? "COST_CAP" : "LOWEST_COST_WITHOUT_CAP";
    const adsetParams = {
      name: `${name} — Ad Set`,
      campaign_id: created.campaignId,
      daily_budget: Math.round(rupees * 100), // paise me
      billing_event: "IMPRESSIONS",
      bid_strategy: normalizedBidStrategy,
      optimization_goal: chosenOptimization,
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
      access_token: T,
    };
    if (normalizedBidStrategy === "COST_CAP" && Number(costCap) > 0) {
      adsetParams.bid_amount = Math.round(Number(costCap) * 100);
    }
    if (startTime) adsetParams.start_time = new Date(startTime).toISOString();
    if (endTime) adsetParams.end_time = new Date(endTime).toISOString();
    const clickDays = attributionWindow === "1d_click" ? 1 : 7;
    const attributionSpec = [{ event_type: "CLICK_THROUGH", window_days: clickDays }];
    if (attributionWindow !== "7d_click") {
      attributionSpec.push({ event_type: "VIEW_THROUGH", window_days: 1 });
    }
    adsetParams.attribution_spec = JSON.stringify(attributionSpec);
    if (creativeMode === "catalog") {
      // Catalog ads: product set promoted object hai (+ pixel agar diya ho)
      adsetParams.optimization_goal = "OFFSITE_CONVERSIONS";
      const po = { product_set_id: productSetId, custom_event_type: "PURCHASE" };
      if (pixelId) po.pixel_id = pixelId;
      adsetParams.promoted_object = JSON.stringify(po);
    } else if (isSales || isWebsiteLead) {
      adsetParams.optimization_goal = "OFFSITE_CONVERSIONS";
      adsetParams.promoted_object = JSON.stringify({
        pixel_id: pixelId,
        custom_event_type: isWebsiteLead ? (conversionEvent || "LEAD") : (conversionEvent || "PURCHASE"),
      });
    }
    const adset = await axios.post(`${GRAPH}/${ACT}/adsets`, null, { params: adsetParams });
    created.adsetId = adset.data.id;

    // ---- 3. Creative (mode ke hisaab se) ----
    const creativeParams = { name: `${name} — Creative`, access_token: T };
    if (creativeMode === "post") {
      // Existing post boost — post hi creative hai
      creativeParams.object_story_id = postId;
    } else if (creativeMode === "catalog") {
      // Catalog/dynamic ad — Meta products se khud carousel banata hai
      const templateData = {
        link: finalLink,
        message: primaryText,
        name: headline || "{{product.name}}",
        description: description || "{{product.current_price}}",
        call_to_action: { type: ctaType },
        multi_share_end_card: multiShareEndCard !== false,
      };
      if (catalogFormat === "single") {
        templateData.force_single_link = true;
        if (showMultipleImages === true) {
          templateData.show_multiple_images = true;
          templateData.multi_share_end_card = false;
        }
      }
      const imageIndex = Number(additionalImageIndex);
      if (Number.isInteger(imageIndex) && imageIndex >= 0 && imageIndex <= 19) {
        templateData.additional_image_index = imageIndex;
      }
      if (automatedProductTags === true) templateData.automated_product_tags = true;
      if (catalogFormat !== "single" && catalogCustomCard?.enabled && catalogCustomCard?.imageHash) {
        const staticCard = {
          call_to_action: { type: ctaType },
          description: String(catalogCustomCard.description || ""),
          image_hash: String(catalogCustomCard.imageHash),
          link: String(catalogCustomCard.link || finalLink),
          name: String(catalogCustomCard.headline || headline || "View offer"),
          static_card: true,
        };
        const dynamicCard = {
          call_to_action: { type: ctaType },
          description: description || "{{product.current_price}}",
          name: headline || "{{product.name}}",
        };
        templateData.child_attachments = catalogCustomCard.position === "after"
          ? [dynamicCard, staticCard]
          : [staticCard, dynamicCard];
      }
      const objectStorySpec = { page_id: pageId, template_data: templateData };
      if (instagramActorId) objectStorySpec.instagram_actor_id = instagramActorId;
      creativeParams.product_set_id = productSetId;
      creativeParams.object_story_spec = JSON.stringify(objectStorySpec);
    } else {
      const objectStorySpec = {
        page_id: pageId,
        link_data: {
          link: finalLink,
          message: primaryText,
          name: headline || undefined,
          description: description || undefined,
          image_hash: imageHash,
          call_to_action: { type: ctaType, value: { link: finalLink } },
        },
      };
      if (instagramActorId) objectStorySpec.instagram_actor_id = instagramActorId;
      creativeParams.object_story_spec = JSON.stringify(objectStorySpec);
    }
    const creative = await axios.post(`${GRAPH}/${ACT}/adcreatives`, null, {
      params: creativeParams,
    });
    created.creativeId = creative.data.id;

    // ---- 4. Ad (PAUSED) ----
    const ad = await axios.post(`${GRAPH}/${ACT}/ads`, null, {
      params: {
        name: `${name} — Ad`,
        adset_id: created.adsetId,
        creative: JSON.stringify({ creative_id: created.creativeId }),
        status: "PAUSED",
        access_token: T,
      },
    });
    created.adId = ad.data.id;

    res.json({
      ok: true,
      message: "Ad ban gaya (PAUSED me hai — activate karne par hi chalega)",
      ...created,
    });
  } catch (err) {
    await rollback();
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/* ============ EDIT: BUDGET ============ */

router.post("/update-budget", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });

    const { campaignId, id, dailyBudget } = req.body;
    const entityId = id || campaignId;
    const rupees = Number(dailyBudget);
    if (!entityId || !rupees || rupees <= 0) {
      return res.status(400).json({ message: "id aur valid dailyBudget do" });
    }
    // Meta paise me leta hai (INR ka minor unit)
    const paise = Math.round(rupees * 100);
    await axios.post(`${GRAPH}/${entityId}`, null, {
      params: { daily_budget: paise, access_token: cfg.accessToken },
    });
    res.json({ ok: true, id: entityId, dailyBudget: rupees });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/* ============ EDIT: STATUS (pause / activate) ============ */

router.post("/update-status", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });

    const { id, status } = req.body;
    const next = String(status || "").toUpperCase();
    if (!id || !["ACTIVE", "PAUSED"].includes(next)) {
      return res.status(400).json({ message: "id aur status (ACTIVE/PAUSED) do" });
    }
    // Wahi endpoint campaign, adset, ad teeno pe kaam karta hai
    await axios.post(`${GRAPH}/${id}`, null, {
      params: { status: next, access_token: cfg.accessToken },
    });
    res.json({ ok: true, id, status: next });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/*
  Campaign / ad set / ad editor. Sirf Meta ke mutable, documented core fields
  whitelist kiye gaye hain. Objective, creative aur historical metrics immutable
  hain, isliye unhe frontend sirf read-only dikhata hai.
*/
router.post("/update-entity", adminProtect, isAdmin, async (req, res) => {
  try {
    const cfg = await getConfig();
    if (!cfg.accessToken) return res.status(400).json({ message: "Token missing" });

    const { id, type, name, status, dailyBudget, lifetimeBudget, startTime, endTime, bidStrategy } = req.body;
    const entityType = String(type || "").toLowerCase();
    if (!id || !["campaign", "adset", "ad"].includes(entityType)) {
      return res.status(400).json({ message: "Valid id aur entity type do" });
    }

    const params = { access_token: cfg.accessToken };
    if (typeof name === "string") {
      const cleanName = name.trim();
      if (!cleanName) return res.status(400).json({ message: "Name khali nahi ho sakta" });
      params.name = cleanName;
    }
    if (status != null) {
      const next = String(status).toUpperCase();
      if (!["ACTIVE", "PAUSED"].includes(next)) {
        return res.status(400).json({ message: "Status ACTIVE ya PAUSED hona chahiye" });
      }
      params.status = next;
    }

    if (entityType !== "ad") {
      if (dailyBudget != null && dailyBudget !== "") {
        const value = Number(dailyBudget);
        if (!Number.isFinite(value) || value < 100) {
          return res.status(400).json({ message: "Daily budget kam se kam ₹100 rakho" });
        }
        params.daily_budget = Math.round(value * 100);
      }
      if (lifetimeBudget != null && lifetimeBudget !== "") {
        const value = Number(lifetimeBudget);
        if (!Number.isFinite(value) || value < 100) {
          return res.status(400).json({ message: "Lifetime budget kam se kam ₹100 rakho" });
        }
        params.lifetime_budget = Math.round(value * 100);
      }
    }

    if (entityType === "adset") {
      if (startTime) params.start_time = new Date(startTime).toISOString();
      if (endTime) params.end_time = new Date(endTime).toISOString();
      if (bidStrategy) {
        const bid = String(bidStrategy).toUpperCase();
        const allowed = ["LOWEST_COST_WITHOUT_CAP", "COST_CAP", "LOWEST_COST_WITH_BID_CAP"];
        if (!allowed.includes(bid)) return res.status(400).json({ message: "Invalid bid strategy" });
        params.bid_strategy = bid;
      }
    }

    if (Object.keys(params).length === 1) {
      return res.status(400).json({ message: "Edit karne ke liye koi field nahi mili" });
    }
    const { data } = await axios.post(`${GRAPH}/${id}`, null, { params });
    res.json({ ok: true, id, type: entityType, meta: data });
  } catch (err) {
    res.status(400).json({ ok: false, message: metaError(err) });
  }
});

/* ============ AI ANALYSIS (Gemini) ============ */
/*
  Poore account ka data ikattha karke Gemini se Hindi me analysis + advice
  mangta hai. GEMINI_API_KEY .env me honi chahiye.
*/
// Windows system env me purani/junk GEMINI key ho sakti hai jo .env ko
// dabaa deti hai — isliye .env FILE ki value ko hamesha priority dete hain
function getGeminiKey() {
  try {
    const envPath = require("path").join(__dirname, "..", ".env");
    const line = require("fs")
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("GEMINI_API_KEY="));
    const v = line && line.split("=").slice(1).join("=").trim();
    if (v) return v;
  } catch {}
  return process.env.GEMINI_API_KEY;
}

router.post("/ai-analysis", adminProtect, isAdmin, async (req, res) => {
  try {
    const key = getGeminiKey();
    if (!key) {
      return res.status(400).json({ message: "GEMINI_API_KEY .env me nahi mili" });
    }
    const cfg = await getConfig();
    if (!cfg.accessToken || !cfg.adAccountId) {
      return res.status(400).json({ message: "Meta Ads configure nahi hua" });
    }
    const T = cfg.accessToken;
    const ACT = `act_${cfg.adAccountId}`;
    const preset = safePreset(req.body.datePreset || "last_30d");

    // Saara data parallel me le aao
    const [ovR, cpR, ageR, platR] = await Promise.allSettled([
      axios.get(`${GRAPH}/${ACT}/insights`, {
        params: { fields: INSIGHT_FIELDS, date_preset: preset, access_token: T },
      }),
      axios.get(`${GRAPH}/${ACT}/campaigns`, {
        params: {
          fields: `name,status,objective,daily_budget,insights.date_preset(${preset}){${INSIGHT_FIELDS}}`,
          limit: 50, access_token: T,
        },
      }),
      axios.get(`${GRAPH}/${ACT}/insights`, {
        params: { fields: "spend,clicks,ctr,actions,action_values", date_preset: preset, breakdowns: "age", access_token: T },
      }),
      axios.get(`${GRAPH}/${ACT}/insights`, {
        params: { fields: "spend,clicks,ctr,actions,action_values", date_preset: preset, breakdowns: "publisher_platform", access_token: T },
      }),
    ]);

    const ov = ovR.status === "fulfilled" ? shapeInsights(ovR.value.data.data?.[0]) : null;
    const camps = cpR.status === "fulfilled"
      ? (cpR.value.data.data || []).map((c) => ({
          name: c.name, status: c.status, objective: c.objective,
          dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
          ...shapeInsights(c.insights?.data?.[0]),
        }))
      : [];
    const byAge = ageR.status === "fulfilled"
      ? (ageR.value.data.data || []).map((r) => ({
          age: r.age, spend: Number(r.spend) || 0, ctr: Number(r.ctr) || 0,
          purchases: pickAction(r.actions || [], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
        }))
      : [];
    const byPlatform = platR.status === "fulfilled"
      ? (platR.value.data.data || []).map((r) => ({
          platform: r.publisher_platform, spend: Number(r.spend) || 0, ctr: Number(r.ctr) || 0,
          purchases: pickAction(r.actions || [], ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]),
        }))
      : [];

    const prompt = `Tum ek expert Meta (Facebook/Instagram) ads consultant ho. Neeche ek Indian toys e-commerce business (bafnatoys.com, INR currency) ke ad account ka ${preset} ka data hai. Iska analysis karke saaf, seedhi Hinglish (Roman Hindi) me jawab do. Structure:
1. 📊 OVERALL — 2-3 line me account ki sehat
2. ✅ KYA ACCHA HAI — bullet points
3. 🔴 SABSE BADI PROBLEM — kahan paisa leak ho raha (numbers ke saath)
4. 🎯 ACTION PLAN — 3-5 concrete steps, priority order me, har step me expected impact
Chhota aur actionable rakho, total 300 words se kam. Sirf plain text, markdown headers mat use karo (emoji theek hai).

DATA:
Overview: ${JSON.stringify(ov)}
Campaigns: ${JSON.stringify(camps)}
Age breakdown: ${JSON.stringify(byAge)}
Platform breakdown: ${JSON.stringify(byPlatform)}`;

    // "gemini-flash-latest" alias hamesha newest flash model pe chalta hai
    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const gr = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { "Content-Type": "application/json" }, timeout: 60000 }
    );
    const text = gr.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return res.status(400).json({ message: "Gemini se jawab nahi mila" });
    res.json({ ok: true, analysis: text, model });
  } catch (err) {
    const gMsg = err?.response?.data?.error?.message;
    if (gMsg && /API key not valid/i.test(gMsg)) {
      return res.status(400).json({
        message: "Gemini API key invalid hai. Nayi key lo: aistudio.google.com/apikey → .env me GEMINI_API_KEY update karo → backend restart",
      });
    }
    res.status(400).json({ message: gMsg || metaError(err) });
  }
});

module.exports = router;
