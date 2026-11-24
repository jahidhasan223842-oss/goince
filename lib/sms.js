// SMS notifications for orders — STUB ONLY.
// No real SMS provider is connected and no money is spent. The admin
// "Send SMS update" button calls sendSms(); until a provider (e.g. SSL
// Wireless, GreenWeb, Twilio) is configured in Settings, it returns
// ok: false with a clear message for the admin instead of sending.
// To wire a real provider later: set the provider + API key in Settings,
// implement the provider call here, and flip isConfigured() to check it.
const SMS_NOT_CONFIGURED = 'SMS provider is not connected yet — add an SMS provider and API key in Settings first.';

function isConfigured() {
  return false;
}

async function sendSms(phone, message) {
  if (!phone || !message) return { ok: false, error: 'Phone number and message are required.' };
  return { ok: false, error: SMS_NOT_CONFIGURED };
}

module.exports = { isConfigured, sendSms, SMS_NOT_CONFIGURED };
