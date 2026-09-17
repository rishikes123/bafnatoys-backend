/**
 * Delhivery B2B (LTL) integration.
 *
 * Ye D2C wale integration se bilkul alag account hai:
 *   D2C  -> track.delhivery.com/api/cmu/create.json   (API key se)
 *   B2B  -> ltl-clients-api.delhivery.com             (username+password se JWT)
 *
 * B2B surface bade, bhaari cartons ke liye bana hai — 15kg+ ke toy boxes
 * yahan D2C parcel se kaafi sasta padte hain.
 */
const axios = require("axios");
const Setting = require("../models/settingModel");

const SETTING_KEY = "delhivery-b2b";

/**
 * Delhivery B2B ke do bilkul alag environment hain — URL, username aur
 * password teeno alag hote hain. Staging ka username `-b2b` se khatam hota
 * hai (jaise BAFNATOYS6722B2B-b2b), live ka bina suffix ke.
 */
const LTL_BASES = {
  staging: "https://ltl-clients-api-dev.delhivery.com",
  live: "https://ltl-clients-api.delhivery.com",
};

const baseUrlFor = (environment) =>
  environment === "live" ? LTL_BASES.live : LTL_BASES.staging;

class DelhiveryB2BError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "DelhiveryB2BError";
    this.statusCode = statusCode;
  }
}

async function getConfig() {
  const setting = await Setting.findOne({ key: SETTING_KEY });
  return setting?.data || null;
}

/**
 * JWT token laata hai — cached token valid ho to wahi, warna naya login.
 * Token Settings me hi cache hota hai (nimbuspost jaisa hi pattern).
 */
async function getToken({ forceRefresh = false } = {}) {
  const config = await getConfig();
  if (!config?.enabled) {
    throw new DelhiveryB2BError(
      "Delhivery B2B Settings me enabled nahi hai",
      400
    );
  }
  if (!config.username || !config.password) {
    throw new DelhiveryB2BError(
      "Delhivery B2B ka username/password Settings me nahi bhara hai",
      400
    );
  }

  const cached = config.token;
  const stillValid =
    cached && config.tokenExpiry && new Date() < new Date(config.tokenExpiry);
  if (cached && stillValid && !forceRefresh) return cached;

  const base = baseUrlFor(config.environment);

  let response;
  try {
    response = await axios.post(
      `${base}/ums/login`,
      { username: config.username, password: config.password },
      { headers: { "Content-Type": "application/json" }, timeout: 20000 }
    );
  } catch (error) {
    const detail =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error.message;
    throw new DelhiveryB2BError(
      `Delhivery B2B login failed (${config.environment || "staging"}): ${detail}`,
      400
    );
  }

  const body = response.data || {};
  const token =
    body.jwt || body.token || body.access_token || body.data?.jwt || body.data?.token;
  if (!token) {
    throw new DelhiveryB2BError(
      `Delhivery B2B login se token nahi mila: ${JSON.stringify(body).slice(0, 300)}`,
      400
    );
  }

  // Token ki umar aksar 24h hoti hai — thoda pehle expire maan lete hain.
  await Setting.findOneAndUpdate(
    { key: SETTING_KEY },
    {
      $set: {
        "data.token": token,
        "data.tokenExpiry": new Date(Date.now() + 23 * 60 * 60 * 1000),
        "data.lastLoginAt": new Date(),
        "data.lastError": "",
      },
    }
  );

  return token;
}

/**
 * Credentials sach me chalte hain ya nahi — admin panel ke "Test Connection"
 * button ke liye. Koi shipment nahi banata, sirf login karke dekhta hai.
 */
async function testConnection() {
  const config = await getConfig();
  if (!config?.username) {
    return { ok: false, message: "Username Settings me nahi bhara hai" };
  }
  try {
    const token = await getToken({ forceRefresh: true });
    const env = config.environment === "live" ? "LIVE" : "STAGING";
    return {
      ok: true,
      message: `Login successful — ${config.username} (${env})`,
      environment: config.environment || "staging",
      tokenPreview: `${String(token).slice(0, 12)}…`,
    };
  } catch (error) {
    await Setting.findOneAndUpdate(
      { key: SETTING_KEY },
      { $set: { "data.lastError": error.message } }
    );
    return { ok: false, message: error.message };
  }
}

/**
 * Authenticated request helper — 401 aane par ek baar token refresh karke
 * dobara try karta hai.
 */
async function authedRequest({ method = "get", path, data, params }) {
  const config = await getConfig();
  const base = baseUrlFor(config?.environment);

  const send = async (token) =>
    axios({
      method,
      url: `${base}${path}`,
      data,
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

  let token = await getToken();
  try {
    return await send(token);
  } catch (error) {
    if (error?.response?.status !== 401) throw error;
    token = await getToken({ forceRefresh: true });
    return send(token);
  }
}

module.exports = {
  DelhiveryB2BError,
  SETTING_KEY,
  LTL_BASES,
  baseUrlFor,
  getConfig,
  getToken,
  testConnection,
  authedRequest,
};
