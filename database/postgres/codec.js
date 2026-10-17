"use strict";

const { BSON } = require("mongodb");

function encode(value) {
  return BSON.EJSON.serialize(value, { relaxed: false });
}
function decode(value) {
  // Match the Mongo Node driver's normal JS value promotion for application reads.
  return BSON.deserialize(BSON.serialize(BSON.EJSON.deserialize(value, { relaxed: false })));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const idKey = id => canonical(encode(id));
function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) {
    throw new Error("Invalid PostgreSQL schema or collection identifier");
  }
  return `"${value}"`;
}

module.exports = { encode, decode, canonical, idKey, identifier };
