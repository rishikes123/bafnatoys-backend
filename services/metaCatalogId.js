function cleanId(value) {
  if (value == null) return "";
  return String(value).trim();
}

/**
 * Meta catalog 3468084830013404 uses Mongo Product._id as retailer_id.
 * SKU must not be used for content_ids unless the catalog itself is migrated.
 */
function getProductCatalogId(product) {
  if (!product) return "";
  return cleanId(product._id || product.id || product);
}

function getOrderItemCatalogId(item) {
  if (!item) return "";
  const product = item.productId;
  if (product && typeof product === "object") {
    return getProductCatalogId(product);
  }
  return cleanId(product || item._id || item.id);
}

function getOrderCatalogIds(items) {
  return [...new Set((items || []).map(getOrderItemCatalogId).filter(Boolean))];
}

module.exports = {
  getProductCatalogId,
  getOrderItemCatalogId,
  getOrderCatalogIds,
};
