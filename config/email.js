// Order confirmation email pathanor jonno helper.
// Kaj korte hole .env file e EMAIL_USER ebong EMAIL_PASS diye rakhte hobe.
// Gmail use korle: "App Password" banate hobe (normal Gmail password kaj korbe na).
// Guide: Google Account -> Security -> 2-Step Verification on -> App Passwords -> generate.

const nodemailer = require('nodemailer');

let transporter = null;

// Email config deya thakle-i transporter toiri hobe, na thakle email pathano skip hobe
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

async function sendOrderConfirmation(toEmail, order) {
  if (!transporter || !toEmail) return; // Email setup na thakle ba customer email na dile, chup chap skip

  const itemsList = order.items
    .map(i => `${i.name} x ${i.quantity} — ৳${(i.price * i.quantity).toFixed(2)}`)
    .join('\n');

  try {
    await transporter.sendMail({
      from: `"Goince" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: `Your Goince Order #${order.id} is Confirmed!`,
      text: `Hi ${order.customer_name},

Thank you for your order! Here are the details:

Order ID: #${order.id}
${itemsList}

Total: ৳${order.total}

We'll notify you once your order ships.

- Team Goince`
    });
    console.log(`Order confirmation email sent to ${toEmail}`);
  } catch (err) {
    // Email fail korle order process thamano uchit na, tai shudhu log kore rakhbo
    console.error('Email send failed:', err.message);
  }
}

async function sendPasswordResetEmail(toEmail, userName, resetLink) {
  if (!transporter || !toEmail) return false; // Email setup na thakle false return, caller fallback dekhabe

  try {
    await transporter.sendMail({
      from: `"Goince" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Reset Your Goince Password',
      text: `Hi ${userName},

Tumi ekta password reset request korecho. Notun password set korte ei link e click koro:

${resetLink}

Ei link ta 1 ghonta porjonto valid thakbe. Jodi tumi ei request na koro thako, ei email ta ignore korte paro.

- Team Goince`
    });
    console.log(`Password reset email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    return false;
  }
}

module.exports = { sendOrderConfirmation, sendPasswordResetEmail };
