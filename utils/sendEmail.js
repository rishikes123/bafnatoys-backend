const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,              // SSL Port
      secure: true,           // True for 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      // 👇 YE LINE ADD KARNA ZAROORI HAI (IPv6 Error Fix)
      // Ye server ko force karega ki wo IPv4 network use kare
      family: 4, 
    });

    const mailOptions = {
      from: `"Bafna Toys System" <${process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully: ${info.messageId}`);
    return info;

  } catch (error) {
    console.error("❌ Email Send Failed:", error.message);
    // Error throw nahi kar rahe taaki order cancel na ho
  }
};

module.exports = sendEmail;