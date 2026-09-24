// Helper for sending order confirmation emails.
// To make this work, set EMAIL_USER and EMAIL_PASS in the .env file.
// If using Gmail: you'll need to create an "App Password" (a normal Gmail password won't work).
// Guide: Google Account -> Security -> 2-Step Verification on -> App Passwords -> generate.

const nodemailer = require('nodemailer');

let transporter = null;

// The transporter is only created if email config is provided; otherwise sending emails is skipped
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
  if (!transporter || !toEmail) return; // Silently skip if email isn't configured or there's no customer email

  const logoUrl = `${order.siteUrl || ''}/icons/icon-512.png`;

  const itemRows = order.items.map(item => {
    const lineTotal = (item.price * item.quantity).toFixed(2);
    const variantRow = item.variantLabel
      ? `<br><span style="font-size:12px;color:#888888;">${item.variantLabel}</span>`
      : '';
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e2e6;color:#16161a;">${item.name}${variantRow}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e2e6;color:#16161a;text-align:right;">৳${Number(item.price).toFixed(2)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e2e6;color:#16161a;text-align:center;">${item.quantity}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e2e6;color:#16161a;text-align:right;">৳${lineTotal}</td>
      </tr>`;
  }).join('');

  const discountRow = (order.discount && Number(order.discount) > 0)
    ? `<tr><td colspan="3" style="padding:4px 0;text-align:right;color:#d62839;">Discount ${order.couponCode ? '(' + order.couponCode + ')' : ''}</td><td style="padding:4px 0;text-align:right;color:#d62839;">- ৳${order.discount}</td></tr>`
    : '';

  const transactionRow = order.transactionId
    ? `<p style="margin:4px 0;font-size:13px;color:#52525c;"><strong style="color:#16161a;">Transaction ID:</strong> ${order.transactionId}</p>`
    : '';

  // Built as an HTML table layout (not flexbox/grid) on purpose — most email
  // clients (Outlook especially) render modern CSS unreliably, so tables with
  // inline styles are still the safest way to get a consistent look everywhere.
  const html = `
  <div style="background:#f1f2f6;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;">
      <tr>
        <td style="background:#1a1a2e;padding:24px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px;"><img src="${logoUrl}" width="44" height="44" alt="Goince" style="display:block;border-radius:8px;"></td>
            <td>
              <div style="color:#ffffff;font-size:20px;font-weight:bold;">Goince</div>
              <div style="color:#bcbcc9;font-size:12px;">Online Shop</div>
            </td>
          </tr></table>
        </td>
      </tr>
      <tr><td style="height:4px;background:linear-gradient(90deg,#f0a500,#2c2c4a);font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:28px;">
          <p style="margin:0 0 4px;font-size:16px;color:#16161a;">Hi <strong>${order.customer_name}</strong>,</p>
          <p style="margin:0 0 20px;font-size:14px;color:#52525c;">Thank you for your order! Here's your invoice.</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr>
              <td style="font-size:13px;color:#52525c;"><strong style="color:#16161a;">Order No.</strong> #${order.id}</td>
              <td style="font-size:13px;color:#52525c;text-align:right;"><strong style="color:#16161a;">Date</strong> ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:6px;">
            <thead>
              <tr style="background:#1a1a2e;">
                <th style="padding:10px 14px;text-align:left;color:#ffffff;font-size:12px;text-transform:uppercase;">Product</th>
                <th style="padding:10px 14px;text-align:right;color:#ffffff;font-size:12px;text-transform:uppercase;">Price</th>
                <th style="padding:10px 14px;text-align:center;color:#ffffff;font-size:12px;text-transform:uppercase;">Qty</th>
                <th style="padding:10px 14px;text-align:right;color:#ffffff;font-size:12px;text-transform:uppercase;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:280px;margin-left:auto;margin-top:10px;font-size:14px;">
            <tr><td style="padding:4px 0;color:#52525c;">Subtotal</td><td style="padding:4px 0;text-align:right;color:#16161a;">৳${order.subtotal}</td></tr>
            ${discountRow}
            <tr><td style="padding:4px 0;color:#52525c;">Delivery Charge</td><td style="padding:4px 0;text-align:right;color:#16161a;">৳${order.deliveryCharge}</td></tr>
            <tr><td style="padding:10px 0 4px;border-top:2px solid #f0a500;font-weight:bold;color:#16161a;">Total Paid</td><td style="padding:10px 0 4px;border-top:2px solid #f0a500;text-align:right;font-weight:bold;font-size:17px;color:#16161a;">৳${order.total}</td></tr>
          </table>

          <div style="margin-top:24px;padding-top:16px;border-top:1px dashed #e2e2e6;">
            <p style="margin:4px 0;font-size:13px;color:#52525c;"><strong style="color:#16161a;">Delivery Address:</strong> ${order.address}</p>
            <p style="margin:4px 0;font-size:13px;color:#52525c;"><strong style="color:#16161a;">Phone:</strong> ${order.phone}</p>
            <p style="margin:4px 0;font-size:13px;color:#52525c;"><strong style="color:#16161a;">Payment Method:</strong> ${order.paymentMethod}</p>
            ${transactionRow}
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#f7f7fa;padding:20px 28px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#16161a;">Thank you for shopping with Goince!</p>
          <p style="margin:0;font-size:12px;color:#52525c;">We'll notify you once your order ships.${order.shopPhone ? ` Questions? Call us at ${order.shopPhone}` : ''}</p>
        </td>
      </tr>
    </table>
  </div>`;

  // Plain-text fallback for email clients that don't render HTML
  const itemsList = order.items
    .map(i => `${i.name}${i.variantLabel ? ' (' + i.variantLabel + ')' : ''} x ${i.quantity} — ৳${(i.price * i.quantity).toFixed(2)}`)
    .join('\n');

  const text = `Hi ${order.customer_name},

Thank you for your order! Here are the details:

Order ID: #${order.id}
${itemsList}

Subtotal: ৳${order.subtotal}
Delivery Charge: ৳${order.deliveryCharge}
Total: ৳${order.total}

We'll notify you once your order ships.

- Team Goince`;

  try {
    await transporter.sendMail({
      from: `"Goince" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: `Your Goince Order #${order.id} is Confirmed!`,
      text,
      html
    });
    console.log(`Order confirmation email sent to ${toEmail}`);
  } catch (err) {
    // A failed email shouldn't stop the order process, so just log it
    console.error('Email send failed:', err.message);
  }
}

async function sendPasswordResetEmail(toEmail, userName, resetLink) {
  if (!transporter || !toEmail) return false; // Return false if email isn't configured; the caller shows a fallback

  try {
    await transporter.sendMail({
      from: `"Goince" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Reset Your Goince Password',
      text: `Hi ${userName},

You requested a password reset. Click the link below to set a new password:

${resetLink}

This link is valid for 1 hour. If you didn't request this, you can safely ignore this email.

- Team Goince`
    });
    console.log(`Password reset email sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    return false;
  }
}

async function sendTestEmail(toEmail) {
  // Used by the admin panel's "Test Email" button — the result is shown right on
  // screen, so there's no need to dig through server logs
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return { success: false, error: 'EMAIL_USER or EMAIL_PASS is empty in the .env file.' };
  }
  if (!transporter) {
    return { success: false, error: 'Email transporter was not created (unknown reason).' };
  }
  try {
    await transporter.sendMail({
      from: `"Goince" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Goince Test Email',
      text: `This is a test email. If you're reading this, Goince's email system is working correctly!`
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message, code: err.code, response: err.response };
  }
}

module.exports = { sendOrderConfirmation, sendPasswordResetEmail, sendTestEmail };
