const Setting = require("../models/settingModel");

/*
  META ADS CONFIG (shared)
  -----------------------
  Ye config pehle metaAdsRoutes.js ke andar hi thi. Ab budget guard aur
  audience sync bhi isi ko use karte hain, isliye alag file me nikal di —
  logic bilkul wahi hai, ek hi jagah rehne se dono kabhi alag nahi honge.
*/

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const SETTING_KEY = "meta-ads";

/*
  MULTI-ACCOUNT: config me accounts ki list hoti hai:
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

// Meta ki galti ko saaf message me badalta hai
function metaError(err) {
  const m = err?.response?.data?.error?.message;
  if (m) return m;
  return err?.message || "Meta API error";
}

module.exports = { META_GRAPH_VERSION, GRAPH, SETTING_KEY, getConfig, saveAccounts, metaError };
