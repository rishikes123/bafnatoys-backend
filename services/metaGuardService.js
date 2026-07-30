const axios = require("axios");
const Setting = require("../models/settingModel");
const { GRAPH, getConfig, metaError } = require("./metaAdsConfig");

/*
  BUDGET GUARD (auto-pause)
  -------------------------
  Kaam: jo campaign paisa kha raha hai par order nahi de raha, use khud
  PAUSE kar deta hai. Din bhar panel dekhne ki zarurat nahi.

  Rule (admin set karta hai):
    "Agar campaign ne <spendThreshold> se zyada kharch kiya aur
     <minPurchases> se kam purchase diye — to pause kar do"

  Safety:
    - Default me BAND hai. Admin khud on karega.
    - dryRun on karo to sirf log banega, pause nahi hoga (pehle test karne ke liye).
    - Ek run me maxPausesPerRun se zyada campaign band nahi honge — taaki
      koi galat setting se poora account ek saath na ruk jaye.
    - Sirf ACTIVE campaign dekhta hai. Kabhi kisi ko chalu nahi karta.
*/

const GUARD_KEY = "meta-ads-guard";

const DEFAULTS = {
  enabled: false,
  window: "today", // today | last_7d
  spendThreshold: 500, // rupees
  minPurchases: 1,
  dryRun: false,
  maxPausesPerRun: 3,
};

const VALID_WINDOWS = ["today", "last_7d"];

function shapeGuard(raw = {}) {
  const w = VALID_WINDOWS.includes(raw.window) ? raw.window : DEFAULTS.window;
  // minPurchases 0 valid hai, isliye || nahi chalega — aur Number(undefined)
  // NaN deta hai jise ?? nahi pakadta. Explicit check hi safe hai.
  const minP = Number(raw.minPurchases);
  return {
    enabled: Boolean(raw.enabled),
    window: w,
    spendThreshold: Math.max(1, Number(raw.spendThreshold) || DEFAULTS.spendThreshold),
    minPurchases: Number.isFinite(minP) ? Math.max(0, minP) : DEFAULTS.minPurchases,
    dryRun: Boolean(raw.dryRun),
    maxPausesPerRun: Math.min(20, Math.max(1, Number(raw.maxPausesPerRun) || DEFAULTS.maxPausesPerRun)),
    lastRunAt: raw.lastRunAt || null,
    log: Array.isArray(raw.log) ? raw.log.slice(0, 50) : [],
  };
}

async function getGuard() {
  const setting = await Setting.findOne({ key: GUARD_KEY });
  return shapeGuard(setting?.data || {});
}

async function saveGuard(next) {
  const clean = shapeGuard(next);
  await Setting.findOneAndUpdate(
    { key: GUARD_KEY },
    { $set: { key: GUARD_KEY, data: clean } },
    { upsert: true, new: true }
  );
  return clean;
}

function purchasesOf(row) {
  const actions = row?.actions || [];
  for (const t of ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"]) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/*
  Ek baar chalao. trigger: "auto" (timer) ya "manual" (admin ne button dabaya).
  Manual run me settings ki enabled flag ignore hoti hai — admin khud maang raha hai.
*/
async function runGuard({ trigger = "auto" } = {}) {
  const guard = await getGuard();
  if (trigger === "auto" && !guard.enabled) {
    return { ran: false, reason: "Guard band hai", guard };
  }

  const cfg = await getConfig();
  if (!cfg.accessToken || !cfg.adAccountId) {
    return { ran: false, reason: "Meta Ads configure nahi hua", guard };
  }

  let campaigns = [];
  try {
    const { data } = await axios.get(`${GRAPH}/act_${cfg.adAccountId}/campaigns`, {
      params: {
        fields: `name,status,effective_status,daily_budget,insights.date_preset(${guard.window}){spend,actions}`,
        limit: 200,
        access_token: cfg.accessToken,
      },
    });
    campaigns = data.data || [];
  } catch (err) {
    return { ran: false, reason: metaError(err), guard };
  }

  const checked = [];
  const actions = [];

  for (const c of campaigns) {
    if (String(c.status).toUpperCase() !== "ACTIVE") continue;

    const row = c.insights?.data?.[0];
    const spend = Number(row?.spend) || 0;
    const purchases = purchasesOf(row);
    const breaksRule = spend >= guard.spendThreshold && purchases < guard.minPurchases;

    checked.push({ id: c.id, name: c.name, spend, purchases, breaksRule });
    if (!breaksRule) continue;
    if (actions.length >= guard.maxPausesPerRun) break;

    const entry = {
      at: new Date().toISOString(),
      trigger,
      campaignId: c.id,
      name: c.name,
      spend,
      purchases,
      window: guard.window,
      rule: `kharch ≥ ₹${guard.spendThreshold} aur purchase < ${guard.minPurchases}`,
      action: guard.dryRun ? "would-pause" : "paused",
      ok: true,
    };

    if (!guard.dryRun) {
      try {
        await axios.post(`${GRAPH}/${c.id}`, null, {
          params: { status: "PAUSED", access_token: cfg.accessToken },
        });
      } catch (err) {
        entry.action = "pause-failed";
        entry.ok = false;
        entry.error = metaError(err);
      }
    }
    actions.push(entry);
  }

  // Naya log upar, purana neeche — sirf 50 rakhte hain
  const log = [...actions, ...guard.log].slice(0, 50);
  const saved = await saveGuard({ ...guard, lastRunAt: new Date().toISOString(), log });

  return {
    ran: true,
    trigger,
    dryRun: guard.dryRun,
    activeChecked: checked.length,
    pausedCount: actions.filter((a) => a.ok && a.action === "paused").length,
    checked,
    actions,
    guard: saved,
  };
}

module.exports = { GUARD_KEY, DEFAULTS, getGuard, saveGuard, runGuard };
