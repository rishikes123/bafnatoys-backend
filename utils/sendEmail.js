const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", // ✅ Explicit Host (Zaroori hai)
      port: 465,              // ✅ Port 465 (SSL) Cloud servers par best chalta hai
      secure: true,           // ✅ True for 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // App Password
      },
    });

    const mailOptions = {
      from: `"Bafna Toys System" <${process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent: ${info.messageId}`);
  } catch (error) {
    // Ye error console me dikhega agar email fail hua
    console.error("❌ Email Error (Server Logs Check Karein):", error);
  }
};

module.exports = sendEmail;