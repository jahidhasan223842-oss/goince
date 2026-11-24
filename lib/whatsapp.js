// WhatsApp Business API (Meta Cloud API) sender for invoices.
// HONEST LIMITS — read this before expecting free WhatsApp messages:
//  - Sending a message from the website is NOT free and NOT the same as the
//    wa.me link (which just opens the customer's WhatsApp app for free).
//    Direct sends need a WhatsApp Business account: a phone number ID, a
//    permanent access token and an APPROVED message template from Meta, and
//    Meta charges per message (per conversation). Until those are saved in
//    Admin > Settings > WhatsApp Business API, every function here returns
//    ok:false with a clear message and sends nothing.
//  - A document (the invoice PDF) can only go out as a TEMPLATE message
//    with a document header — the template (default name "invoice_pdf")
//    must be approved by Meta first. The PDF is uploaded to Meta's media
//    endpoint, then the template message references the media id.
//  - No unofficial/scraping method is used here, and no WhatsApp account
//    is connected. The free wa.me link on the order page stays as it is.
// Keys live in the `settings` table (Admin > Settings) — never hardcoded.
const WHATSAPP_SETTING_KEYS = [
  'whatsapp_phone_number_id', 'whatsapp_access_token', 'whatsapp_template_name',
];

const NOT_CONFIGURED = 'WhatsApp Business API is not connected yet — add the phone number ID and access token in Settings > WhatsApp Business API first. Meta charges per message and the invoice template must be approved by Meta.';

async function getWhatsAppConfig(db) {
  const [rows] = await db.query(
    'SELECT setting_key, setting_value FROM settings WHERE setting_key IN (' + WHATSAPP_SETTING_KEYS.map(() => '?').join(',') + ')',
    WHATSAPP_SETTING_KEYS
  );
  const get = (k, fb) => { const r = rows.find(x => x.setting_key === k); return r ? r.setting_value : fb; };
  const cfg = {
    phoneNumberId: get('whatsapp_phone_number_id', ''),
    accessToken: get('whatsapp_access_token', ''),
    templateName: get('whatsapp_template_name', 'invoice_pdf') || 'invoice_pdf',
  };
  cfg.configured = !!(cfg.phoneNumberId && cfg.accessToken);
  return cfg;
}

function isConfigured(cfg) { return !!(cfg && cfg.configured); }

function toWhatsAppPhone(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^0/, '880');
}

async function callApi(url, options, fetchImpl) {
  const res = await fetchImpl(url, options);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// Upload the invoice PDF to Meta and return the media id.
async function uploadMedia(cfg, pdfBuffer, filename, fetchImpl) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);
  form.append('type', 'application/pdf');
  const r = await callApi(
    'https://graph.facebook.com/v21.0/' + cfg.phoneNumberId + '/media',
    { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.accessToken }, body: form },
    fetchImpl
  );
  if (!r.ok || !r.data || !r.data.id) {
    return { ok: false, error: 'WhatsApp media upload failed' + (r.data && r.data.error ? ': ' + r.data.error.message : ' (HTTP ' + r.status + ')') };
  }
  return { ok: true, mediaId: r.data.id };
}

// Send the invoice PDF as a document inside the approved template message.
// bodyParams fill the template's {{1}}, {{2}} ... placeholders (order no, total).
async function sendInvoiceDocument(cfg, toPhone, pdfBuffer, filename, bodyParams, fetchImpl) {
  const f = fetchImpl || fetch;
  if (!isConfigured(cfg)) return { ok: false, error: NOT_CONFIGURED };
  const to = toWhatsAppPhone(toPhone);
  if (!to) return { ok: false, error: 'Customer phone number is required.' };
  const up = await uploadMedia(cfg, pdfBuffer, filename, f);
  if (!up.ok) return up;
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: cfg.templateName,
      language: { code: 'en' },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: up.mediaId, filename } }] },
        { type: 'body', parameters: (bodyParams || []).map(p => ({ type: 'text', text: String(p) })) },
      ],
    },
  };
  const r = await callApi(
    'https://graph.facebook.com/v21.0/' + cfg.phoneNumberId + '/messages',
    { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    f
  );
  if (!r.ok) {
    return { ok: false, error: 'WhatsApp send failed' + (r.data && r.data.error ? ': ' + r.data.error.message : ' (HTTP ' + r.status + ')') };
  }
  return { ok: true, messageId: r.data && r.data.messages && r.data.messages[0] ? r.data.messages[0].id : null };
}

module.exports = { getWhatsAppConfig, isConfigured, toWhatsAppPhone, sendInvoiceDocument, NOT_CONFIGURED };
