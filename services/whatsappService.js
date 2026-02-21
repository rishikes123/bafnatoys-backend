const axios = require("axios");

const WA_API_VERSION = process.env.WA_API_VERSION;
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;

async function sendWhatsAppTemplate({ to, templateName, languageCode = "en_US", components = [] }) {
  if (!WA_API_VERSION || !WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
    throw new Error("WhatsApp env missing (WA_API_VERSION/WA_PHONE_NUMBER_ID/WA_ACCESS_TOKEN)");
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  return resp.data;
}

module.exports = { sendWhatsAppTemplate };