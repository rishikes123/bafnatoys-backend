"use strict";

const enabled = () => process.env.MIGRATION_READ_ONLY === "true";

function migrationReadOnly(req, res, next) {
  if (enabled() && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.set("Retry-After", "60");
    return res.status(503).json({ code: "DATABASE_MIGRATION", message: "Store updates are temporarily paused for database maintenance. Please retry shortly." });
  }
  next();
}

function guardMongoWrites() {
  if (!enabled()) return;
  const Collection = require("mongoose/lib/drivers/node-mongodb-native/collection");
  for (const method of ["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "bulkWrite"]) {
    Collection.prototype[method] = async function() { throw new Error("Database is in migration read-only mode"); };
  }
}
module.exports = { migrationReadOnly, guardMongoWrites, enabled };
