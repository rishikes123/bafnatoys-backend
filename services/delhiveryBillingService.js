const Order = require("../models/orderModel");
const DelhiveryLedger = require("../models/DelhiveryLedger");

const normalizeAwb = (value) => String(value || "").trim();

function getOrderAwbs(order) {
  return Array.from(
    new Set(
      [
        normalizeAwb(order?.trackingId),
        ...((order?.splitShipments || []).map((shipment) => normalizeAwb(shipment?.awb))),
      ].filter(Boolean)
    )
  );
}

function ledgerRowTotal(row) {
  const explicitTotal = Number(row?.totalAmount || 0);
  if (explicitTotal) return explicitTotal;
  return (
    Number(row?.grossAmount || 0) +
    Number(row?.igst || 0) +
    Number(row?.cgst || 0) +
    Number(row?.sgst || 0)
  );
}

function buildFinalBilling(rows = []) {
  if (!rows.length) return null;

  const freight = rows.reduce((sum, row) => sum + Number(row.grossAmount || 0), 0);
  const tax = rows.reduce(
    (sum, row) =>
      sum + Number(row.igst || 0) + Number(row.cgst || 0) + Number(row.sgst || 0),
    0
  );
  const total = rows.reduce((sum, row) => sum + ledgerRowTotal(row), 0);
  const chargedWeight = rows.reduce(
    (sum, row) => sum + Number(row.chargedWeight || 0),
    0
  );
  const zones = Array.from(new Set(rows.map((row) => row.zone).filter(Boolean)));
  const statuses = Array.from(new Set(rows.map((row) => row.status).filter(Boolean)));
  const codFee = rows.reduce((sum, row) => {
    const breakdown = row.chargeBreakdown instanceof Map
      ? Object.fromEntries(row.chargeBreakdown)
      : (row.chargeBreakdown || {});
    return sum + Number(breakdown.COD || breakdown.charge_COD || 0);
  }, 0);
  const syncedAt = rows.reduce((latest, row) => {
    const date = row.uploadedAt ? new Date(row.uploadedAt) : null;
    return date && (!latest || date > latest) ? date : latest;
  }, null);

  return {
    actualDeliveryCharge: Number(total.toFixed(2)),
    deliveryChargeStatus: "final",
    deliveryChargeSource: "ledger_csv",
    deliveryChargeDetails: {
      freight: Number(freight.toFixed(2)),
      tax: Number(tax.toFixed(2)),
      total: Number(total.toFixed(2)),
      codCollected: Number(
        rows.reduce((sum, row) => sum + Number(row.codAmount || 0), 0).toFixed(2)
      ),
      codFee: Number(codFee.toFixed(2)),
      chargedWeight: Number(chargedWeight.toFixed(3)),
      zone: zones.join(", "),
      ledgerStatus: statuses.join(", "),
      syncedAt: syncedAt || new Date(),
      awbs: rows.map((row) => normalizeAwb(row.waybill)).filter(Boolean),
    },
  };
}

async function getLedgerMapForOrders(orders = []) {
  const allAwbs = Array.from(new Set(orders.flatMap(getOrderAwbs)));
  if (!allAwbs.length) return new Map();

  const rows = await DelhiveryLedger.find({ waybill: { $in: allAwbs } }).lean();
  return new Map(rows.map((row) => [normalizeAwb(row.waybill), row]));
}

function billingForOrder(order, ledgerMap) {
  const rows = getOrderAwbs(order)
    .map((awb) => ledgerMap.get(awb))
    .filter(Boolean);
  return buildFinalBilling(rows);
}

async function attachLedgerBilling(orders = []) {
  if (!orders.length) return orders;
  const ledgerMap = await getLedgerMapForOrders(orders);

  return orders.map((order) => {
    const billing = billingForOrder(order, ledgerMap);
    return billing ? { ...order, ...billing } : order;
  });
}

async function syncOrdersForWaybills(waybills = []) {
  const normalized = Array.from(new Set(waybills.map(normalizeAwb).filter(Boolean)));
  if (!normalized.length) return { matchedOrders: 0, updatedOrders: 0 };

  const orders = await Order.find({
    $or: [
      { trackingId: { $in: normalized } },
      { "splitShipments.awb": { $in: normalized } },
    ],
  }).lean();
  if (!orders.length) return { matchedOrders: 0, updatedOrders: 0 };

  const ledgerMap = await getLedgerMapForOrders(orders);
  const operations = orders
    .map((order) => {
      const billing = billingForOrder(order, ledgerMap);
      if (!billing) return null;
      return {
        updateOne: {
          filter: { _id: order._id },
          update: { $set: billing },
        },
      };
    })
    .filter(Boolean);

  if (!operations.length) return { matchedOrders: orders.length, updatedOrders: 0 };
  const result = await Order.bulkWrite(operations);
  return {
    matchedOrders: orders.length,
    updatedOrders: result.modifiedCount || result.matchedCount || 0,
  };
}

module.exports = {
  attachLedgerBilling,
  buildFinalBilling,
  getOrderAwbs,
  syncOrdersForWaybills,
};
