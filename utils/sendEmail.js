const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,              // ✅ Port change kiya (465 -> 587)
      secure: false,          // ✅ Port 587 ke liye ye FALSE hona chahiye
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      // ✅ Network fix (IPv4 only)
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
  }
};

module.exports = sendEmail;