const nodemailer = require("nodemailer");

const sendEmail = async (options) => {
  try {
    // Production ready transporter configuration
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", // Gmail Host
      port: 465,              // Secure SSL Port (Best for Cloud Servers)
      secure: true,           // True for 465
      auth: {
        user: process.env.EMAIL_USER, // houseofrattles@gmail.com
        pass: process.env.EMAIL_PASS, // Aapka App Password
      },
    });

    const mailOptions = {
      from: `"Bafna Toys System" <${process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    // Email send karne ki koshish
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to: ${options.to}`);
    return info;

  } catch (error) {
    console.error("❌ Email send error:", error.message);
    // Error ko throw nahi karenge taaki order process na ruke
  }
};

module.exports = sendEmail;