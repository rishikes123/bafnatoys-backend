const axios = require("axios");
const fs = require("fs");
const path = require("path");

/*
  GEMINI CALLER (retry + fallback)
  -------------------------------
  Problem: Gemini free tier busy hone par 429/503 deta hai —
  "This model is currently experiencing high demand". Pehle ye seedha
  panel me error bankar dikh jaata tha.

  Ab: har model pe 3 baar try (badhta hua wait), aur ek model na chale to
  agle model pe chala jaata hai. Sirf tab fail hota hai jab saare
  model + retry khatam ho jayein.
*/

// Windows system env me purani/junk GEMINI key ho sakti hai jo .env ko
// dabaa deti hai — isliye .env FILE ki value ko hamesha priority dete hain
function getGeminiKey() {
  try {
    const envPath = path.join(__dirname, "..", ".env");
    const line = fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("GEMINI_API_KEY="));
    const v = line && line.split("=").slice(1).join("=").trim();
    if (v) return v;
  } catch {}
  return process.env.GEMINI_API_KEY;
}

// Pehla model .env se, uske baad ye fallback chain
function modelChain() {
  const chain = [
    process.env.GEMINI_MODEL,
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    "gemini-flash-latest",
  ].filter(Boolean);
  return [...new Set(chain)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isQuotaError(err) {
  const msg = String(err?.response?.data?.error?.message || err?.message || "");
  return /prepayment credits|quota|RESOURCE_EXHAUSTED|depleted|billing/i.test(msg);
}

// Ye galtiyan thodi der baad theek ho jaati hain — inpe retry karna chahiye
function isBusyError(err) {
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.error?.message || err?.message || "");
  if (status === 429 || status === 500 || status === 503 || status === 504) return true;
  return /high demand|overload|unavailable|try again|rate limit|timeout|ECONNRESET|ETIMEDOUT/i.test(msg);
}

function isKeyError(err) {
  const msg = String(err?.response?.data?.error?.message || "");
  return /API key not valid|API_KEY_INVALID|permission denied/i.test(msg);
}

/*
  prompt bhejo, text wapas milta hai.
  generationConfig optional — JSON chahiye to { responseMimeType: "application/json" } bhejo.
*/
async function generate(prompt, generationConfig, options = {}) {
  const key = getGeminiKey();
  if (!key) {
    const e = new Error("GEMINI_API_KEY .env me nahi mili");
    e.friendly = e.message;
    throw e;
  }

  const attemptsPerModel = Number(options.attemptsPerModel) || 2;
  const timeout = Number(options.timeout) || 60000;
  const models = modelChain();
  let lastErr = null;

  for (const model of models) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      try {
        const body = { contents: [{ parts: [{ text: prompt }] }] };
        if (generationConfig) body.generationConfig = generationConfig;

        const { data } = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          body,
          { headers: { "Content-Type": "application/json" }, timeout }
        );
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("Gemini se khali jawab aaya");
        return { text, model, attempts: attempt + 1 };
      } catch (err) {
        lastErr = err;

        if (isKeyError(err)) {
          const e = new Error(
            "Gemini API key invalid hai. Nayi key lo: aistudio.google.com/apikey → .env me GEMINI_API_KEY update karo → backend restart"
          );
          e.friendly = e.message;
          throw e;
        }

        if (isQuotaError(err)) {
          const e = new Error(
            "Google Gemini API Key ke free credits khatam ho gaye hain (Quota Depleted). Kripya aistudio.google.com/apikey se NAYI KEY lekar backend .env me GEMINI_API_KEY update karein."
          );
          e.friendly = e.message;
          throw e;
        }

        if (!isBusyError(err)) break;

        if (attempt < attemptsPerModel - 1) await sleep(600 * Math.pow(2, attempt));
      }
    }
  }

  if (isQuotaError(lastErr)) {
    const e = new Error(
      "Google Gemini API Key ke free credits khatam ho gaye hain (Quota Depleted). Kripya aistudio.google.com/apikey se NAYI KEY lekar backend .env me GEMINI_API_KEY update karein."
    );
    e.friendly = e.message;
    throw e;
  }

  const e = new Error(
    "Gemini API busy hai ya credits depleted hain. Kripya aistudio.google.com/apikey se NAYI KEY generate karke .env me GEMINI_API_KEY update karein."
  );
  e.friendly = e.message;
  e.cause = lastErr;
  throw e;
}

// AI ke jawab me se JSON object nikalta hai (```json fence hata kar)
function parseJsonObject(text) {
  const clean = String(text || "").replace(/```json|```/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI response JSON format me nahi aaya");
  return JSON.parse(clean.slice(start, end + 1));
}

module.exports = { generate, getGeminiKey, parseJsonObject };
