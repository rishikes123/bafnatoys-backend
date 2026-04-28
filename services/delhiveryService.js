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
   1. WALLET BALANCE — try multiple endpoints (classic + Delhivery One)
   --------------------------------------------------------------- */
async function getWalletBalance() {
  // Delhivery has multiple possible wallet endpoints depending on account type:
  //  (a) Classic API:     /api/account/balance.json
  //  (b) Delhivery One:   /api/finances/unified/balance
  //  (c) B2B CMU:         /api/cmu/account/balance.json
  const endpoints = [
    `${BASE}/api/account/balance.json`,
    `${BASE}/api/finances/unified/balance`,
    `${BASE}/api/cmu/account/balance.json`,
    `https://one.delhivery.com/api/finances/unified/balance`,
  ];

  for (const url of endpoints) {
    try {
      const { data } = await axios.get(url, { headers: headers(), timeout: 10000 });
      const balance =
        data?.balance ??
        data?.wallet_balance ??
        data?.current_balance ??
        data?.data?.balance ??
        data?.data?.current_balance ??
        null;
      if (balance !== null && balance !== undefined) {
        return {
          ok: true,
          balance: Number(balance),
          totalCredit:
            Number(data?.total_credit ?? data?.data?.total_credit ?? 0) || null,
          totalDebit:
            Number(data?.total_debit ?? data?.data?.total_debit ?? 0) || null,
          endpoint: url,
          raw: data,
        };
      }
    } catch (_err) {
      // try next endpoint
    }
  }

  return {
    ok: false,
    message:
      "Wallet balance API not enabled on any Delhivery endpoint for this account. Upload CSV ledger to view wallet data.",
  };
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

/* ---------------------------------------------------------------
   7. WALLET TRANSACTION HISTORY (recharges + debits)
   --------------------------------------------------------------- */
async function getWalletTransactions({ from, to, limit = 100 } = {}) {
  // Try multiple endpoints in order — first one that succeeds wins.
  const params = new URLSearchParams();
  if (from) params.append("from", from);
  if (to) params.append("to", to);
  if (limit) params.append("limit", limit);
  const qs = params.toString();

  // Also try Delhivery One's unified date format (ISO)
  const isoParams = new URLSearchParams();
  if (from) isoParams.append("from_date", new Date(from * 1000).toISOString().slice(0, 10));
  if (to) isoParams.append("to_date", new Date(to * 1000).toISOString().slice(0, 10));
  if (limit) isoParams.append("limit", limit);
  const isoQs = isoParams.toString();

  const endpoints = [
    `${BASE}/api/cmu/account/recharge-transaction.json?${qs}`,
    `${BASE}/api/finances/unified/transactions?${isoQs}`,
    `${BASE}/api/finances/unified/ledger?${isoQs}`,
    `https://one.delhivery.com/api/finances/unified/transactions?${isoQs}`,
  ];

  const attempts = [];
  for (const url of endpoints) {
    try {
      const { data } = await axios.get(url, { headers: headers(), timeout: 15000 });
      // Check if data actually has transactions (not just an empty OK)
      const list =
        data?.data ||
        data?.transactions ||
        data?.results ||
        (Array.isArray(data) ? data : null);
      if (list && (Array.isArray(list) ? list.length : true)) {
        return { ok: true, data, endpoint: url };
      }
      attempts.push({ url, status: "empty" });
    } catch (err) {
      attempts.push({
        url,
        status: err?.response?.status || "network",
      });
    }
  }

  return {
    ok: false,
    error: "No Delhivery wallet transaction endpoint returned data for this account.",
    attempts,
  };
}

/* ---------------------------------------------------------------
   8. PER-SHIPMENT CHARGES — compute from rate API for each AWB
   --------------------------------------------------------------- */
async function getShipmentCharges(awbs = []) {
  const tracking = await trackMultiple(awbs);
  return tracking?.ShipmentData || [];
}

/* ---------------------------------------------------------------
   9. ACTUAL DELHIVERY CHARGES PER ORDER (freight + COD fee)
   Uses the rate calculator with real charged weight + destination pin.
   Returns map: { [awb]: { freightCharge, codCharge, totalCharge, zone, chargedWeight } }
   --------------------------------------------------------------- */
async function getActualChargesForOrders(orders = [], trackingLiveMap = {}) {
  const o_pin = process.env.DELHIVERY_WAREHOUSE_PINCODE || "641001";

  const parseRate = (r) => {
    if (!r) return null;
    const data = Array.isArray(r) ? r[0] : r;
    if (!data) return null;
    return {
      freightCharge: Number(data.gross_amount ?? data.freight_charge ?? data.total_amount ?? 0),
      codCharge:     Number(data.cod_charges  ?? data.cod_charge     ?? 0),
      totalCharge:   Number(data.total_amount ?? data.gross_amount   ?? 0),
      zone:          data.zone || "",
      chargedWeight: Number(data.charged_weight ?? 0),
    };
  };

  const tasks = orders
    .filter((o) => o.trackingId && trackingLiveMap[o.trackingId])
    .map(async (o) => {
      const live      = trackingLiveMap[o.trackingId];
      const d_pin     = o.shippingAddress?.pincode;
      if (!d_pin || !/^\d{6}$/.test(d_pin)) return null;

      // ChargedWeight from Delhivery tracking (in kg) → convert to grams
      const cgm = live.chargedWeight
        ? Math.round(live.chargedWeight * 1000)
        : 500;

      const isCOD = o.paymentMode === "COD";
      const pt    = isCOD ? "COD" : "Pre-paid";
      const cod   = isCOD ? o.total : 0;

      try {
        const result = await getShippingRate({ o_pin, d_pin, cgm, pt, cod, md: "E" });
        const parsed = parseRate(result);
        if (!parsed) return null;
        return { awb: o.trackingId, ...parsed };
      } catch (_e) {
        return null;
      }
    });

  const results = await Promise.allSettled(tasks);
  const map = {};
  results.forEach((r) => {
    if (r.status === "fulfilled" && r.value) {
      map[r.value.awb] = r.value;
    }
  });
  return map;
}

module.exports = {
  getWalletBalance,
  getWalletTransactions,
  getShipmentCharges,
  getActualChargesForOrders,
  trackPackage,
  trackMultiple,
  checkPincode,
  getShippingRate,
  createPickupRequest,
  ndrAction,
  PICKUP_LOCATION,
};
