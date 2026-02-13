const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",

      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },

      // ✅ IMPORTANT TIMEOUTS (prevents hanging)
      connectionTimeout: 15000, // 15 sec
      greetingTimeout: 10000,   // 10 sec
      socketTimeout: 20000,     // 20 sec

      tls: {
        rejectUnauthorized: false,
      },
    });

    const mailOptions = {
      from: `"Bafna Toys System" <${process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    // ✅ Wrap with timeout safety
    await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Email send timeout")), 20000)
      ),
    ]);

    console.log(`✅ Email sent to ${options.to}`);
  } catch (error) {
    console.error("❌ Email send error:", error.message);
  }
};

module.exports = sendEmail;
