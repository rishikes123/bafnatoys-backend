// backend/services/delhiveryService.js
// Thin wrapper over Delhivery public APIs. All functions throw on HTTP error.
// Docs: https://track.delhivery.com/api-docs/
const axios = require("axios");

const BASE = "https://track.delhivery.com";
const TOKEN = process.env.DELHIVERY_API_KEY;
const PICKUP_LOCATION =
  process.env.DELHIVERY_PICKUP_LOCATION_NAME || "BAFNATOYS";

if (!TOKEN) {
  console.warn(
    "⚠️ DELHIVERY_API_KEY missing in .env — Delhivery admin APIs will fail."
  );
}

const headers = () => ({
  Authorization: `Token ${TOKEN}`,
  Accept: "application/json",
});

/* ---------------------------------------------------------------
   1. WALLET BALANCE
   --------------------------------------------------------------- */
async function getWalletBalance() {
  // Note: Delhivery doesn't publish an official wallet API in their public
  // docs. Some B2B accounts use this endpoint. We try it; on failure we
  // return null so the UI can gracefully hide the card.
  try {
    const url = `${BASE}/api/account/balance.json`;
    const { data } = await axios.get(url, { headers: headers(), timeout: 10000 });
    return { ok: true, balance: data?.balance ?? data?.wallet_balance ?? null, raw: data };
  } catch (err) {
    return {
      ok: false,
      message:
        "Wallet balance API not enabled for this account. Check Delhivery dashboard manually.",
      error: err?.response?.data || err.message,
    };
  }
}

/* ---------------------------------------------------------------
   2. PACKAGE / SHIPMENT TRACKING
   --------------------------------------------------------------- */
async function trackPackage(waybill) {
  // Track by AWB / waybill. Comma separated for multiple.
  const url = `${BASE}/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`;
  const { data } = await axios.get(url, { headers: headers(), timeout: 15000 });
  return data;
}

async function trackMultiple(waybills = []) {
  if (!waybills.length) return { ShipmentData: [] };
  // Delhivery accepts comma separated list (up to ~50)
  const list = waybills.slice(0, 50).join(",");
  return trackPackage(list);
}

/* ---------------------------------------------------------------
   3. PINCODE SERVICEABILITY
   --------------------------------------------------------------- */
async function checkPincode(pin) {
  const url = `${BASE}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`;
  const { data } = await axios.get(url, { headers: headers(), timeout: 10000 });
  return data;
}

/* ---------------------------------------------------------------
   4. RATE / INVOICE CHARGES
   --------------------------------------------------------------- */
async function getShippingRate({
  md = "E", // E = express, S = surface
  ss = "Delivered",
  d_pin,
  o_pin,
  cgm = 500, // chargeable weight in grams
  pt = "Pre-paid", // "Pre-paid" or "COD"
  cod = 0,
}) {
  const params = new URLSearchParams({
    md,
    ss,
    d_pin,
    o_pin,
    cgm,
    pt,
    cod,
  });
  const url = `${BASE}/api/kinko/v1/invoice/charges/.json?${params.toString()}`;
  const { data } = await axios.get(url, { headers: headers(), timeout: 10000 });
  return data;
}

/* ---------------------------------------------------------------
   5. PICKUP REQUEST
   --------------------------------------------------------------- */
async function createPickupRequest({
  pickup_date, // YYYY-MM-DD
  pickup_time = "12:00:00", // HH:MM:SS
  pickup_location = PICKUP_LOCATION,
  expected_package_count = 1,
}) {
  const url = `${BASE}/fm/request/new/`;
  const body = {
    pickup_location,
    pickup_date,
    pickup_time,
    expected_package_count,
  };
  const { data } = await axios.post(url, body, {
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
  return data;
}

/* ---------------------------------------------------------------
   6. NDR ACTION (re-attempt / RTO)
   --------------------------------------------------------------- */
async function ndrAction({ waybill, act = "RE-ATTEMPT" }) {
  // act = "RE-ATTEMPT" | "RTO" | "DEFER_DLV"
  const url = `${BASE}/api/p/update`;
  const body = {
    data: [
      {
        waybill,
        act,
      },
    ],
  };
  const { data } = await axios.post(url, body, {
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
  return data;
}

module.exports = {
  getWalletBalance,
  trackPackage,
  trackMultiple,
  checkPincode,
  getShippingRate,
  createPickupRequest,
  ndrAction,
  PICKUP_LOCATION,
};
