// services/whatsappService.js
const axios = require("axios");

function normalizeComponents(components = []) {
  return (components || []).map((comp) => {
    if (!comp || !Array.isArray(comp.parameters)) return comp;

    return {
      ...comp,
      parameters: comp.parameters.map((p) => {
        // Meta expects ONLY { type, text } for normal text params
        const type = p?.type || "text";

        if (type === "text") {
          return {
            type: "text",
            text: String(p?.text ?? ""),
          };
        }

        // In case you ever send other param types later (currency, image, etc.)
        const cleaned = { type };
        if (p?.text != null) cleaned.text = String(p.text);
        if (p?.currency != null) cleaned.currency = p.currency;
        if (p?.date_time != null) cleaned.date_time = p.date_time;
        if (p?.image != null) cleaned.image = p.image;
        if (p?.document != null) cleaned.document = p.document;
        if (p?.video != null) cleaned.video = p.video;
        return cleaned;
      }),
    };
  });
}

async function sendWhatsAppTemplate({
  to,
  templateName,
  languageCode = "en_US",
  components = [],
}) {
  const WA_API_VERSION = process.env.WA_API_VERSION || "v20.0";
  const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
  const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;

  if (!WA_PHONE_NUMBER_ID || !WA_ACCESS_TOKEN) {
    throw new Error("WhatsApp env missing (WA_PHONE_NUMBER_ID/WA_ACCESS_TOKEN)");
  }

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;

  // ✅ Normalize here to prevent Meta API errors
  const safeComponents = normalizeComponents(components);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(safeComponents.length ? { components: safeComponents } : {}),
    },
  };

  try {
    const resp = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return resp.data;
  } catch (err) {
    const details = err?.response?.data || err.message;
    console.error("❌ WhatsApp API ERROR:", JSON.stringify(details, null, 2));
    throw err;
  }
}

module.exports = { sendWhatsAppTemplate };