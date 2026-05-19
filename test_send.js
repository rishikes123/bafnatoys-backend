const axios = require("axios");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const { sendWhatsAppTemplate } = require("./services/whatsappService");

async function run() {
  const toRaw = process.argv[2];
  const templateName = process.argv[3] || "hello_world"; // Default to Meta's test template

  if (!toRaw) {
    console.log("\n❌ Please provide a phone number to send the test message to!");
    console.log("Usage: node test_send.js <phone_number_with_country_code> [template_name]");
    console.log("Example 1 (Meta standard test): node test_send.js 919876543210");
    console.log("Example 2 (Cart Recovery template): node test_send.js 919876543210 cart_recovery_message\n");
    return;
  }

  // Normalize phone number to digits only (e.g. +91 98765-43210 -> 919876543210)
  let to = String(toRaw).replace(/\D/g, "");
  if (to.length === 10) {
    to = "91" + to; // Default to India +91 if 10 digits
  }

  console.log(`\n🚀 Preparing to send test message...`);
  console.log(`   - To: +${to}`);
  console.log(`   - Template: ${templateName}`);
  console.log(`   - Language: en_US`);

  // Build parameters if they use the cart recovery template
  let components = [];
  if (templateName === "cart_recovery_message") {
    components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: "Test Shop" },
          { type: "text", text: "2 items" },
          { type: "text", text: "Rs 500" },
          { type: "text", text: "https://bafnatoys.com/cart" }
        ]
      }
    ];
    console.log("   - Packing parameters for cart_recovery_message...");
  }

  try {
    const result = await sendWhatsAppTemplate({
      to,
      templateName,
      languageCode: "en_US",
      components
    });

    console.log("\n🎉 SUCCESS! Message successfully accepted by Meta Cloud API.");
    console.log("Response Details:");
    console.log(JSON.stringify(result, null, 2));
    console.log("\nCheck your mobile phone, the message should arrive in a few seconds! 📱✨\n");

  } catch (err) {
    console.error("\n❌ FAILED to send test WhatsApp message.");
    console.error("Meta API Error Details:");
    console.error(JSON.stringify(err.response?.data || err.message, null, 2));
    console.log("\n");
  }
}

run();
