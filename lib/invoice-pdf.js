// Minimal pure-JS PDF generator for invoices — no new dependency.
// pdfkit and puppeteer are NOT installed in this project, and adding a heavy
// PDF library (or a headless browser) just for a one-page invoice would slow
// every deploy. This builds a small, valid single-page PDF by hand:
// Helvetica text lines + a correct xref table, no images.
// LIMITATIONS (honest): text only, English only — the ৳ sign and Bengali
// text cannot render in the built-in Helvetica font, so amounts are shown
// as "Tk 370.00" and all labels are English. Long item lists are truncated
// to fit one page (max 22 item lines). For a fancier invoice, install pdfkit
// later and swap buildInvoicePdf() — the callers only depend on its return
// value (a Buffer).
function escapePdfText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '');
}

function buildInvoicePdf(data) {
  const lines = [];
  const add = (text, size, y) => lines.push({ text: escapePdfText(text), size, y });
  let y = 760;
  add('GOINCE - Online Shop', 18, y); y -= 24;
  add('INVOICE ' + data.invoiceNo, 14, y); y -= 22;
  add('Date: ' + data.date, 11, y); y -= 16;
  add('Status: ' + data.status + '  |  Payment: ' + data.paymentStatus, 11, y); y -= 24;
  add('Billed To: ' + data.customerName, 12, y); y -= 16;
  if (data.phone) { add('Phone: ' + data.phone, 11, y); y -= 16; }
  if (data.email) { add('Email: ' + data.email, 11, y); y -= 16; }
  if (data.address) { add('Address: ' + data.address, 11, y); y -= 16; }
  if (data.deliveryZone) { add('Delivery Zone: ' + data.deliveryZone, 11, y); y -= 16; }
  y -= 8;
  add('Items:', 12, y); y -= 18;
  const items = (data.items || []).slice(0, 22);
  for (const it of items) {
    const lineTotal = Number(it.price || 0) * Number(it.quantity || 0);
    add(it.product_name + '  x ' + it.quantity + '  -  Tk ' + lineTotal.toFixed(2), 10, y);
    y -= 14;
  }
  if ((data.items || []).length > 22) { add('... and ' + ((data.items || []).length - 22) + ' more item(s) - see the website invoice.', 10, y); y -= 14; }
  y -= 10;
  add('Subtotal: Tk ' + Number(data.subtotal || 0).toFixed(2), 11, y); y -= 16;
  if (Number(data.discount || 0) > 0) { add('Discount: - Tk ' + Number(data.discount).toFixed(2), 11, y); y -= 16; }
  add('Delivery Charge: Tk ' + Number(data.deliveryCharge || 0).toFixed(2), 11, y); y -= 16;
  add('Total: Tk ' + Number(data.total || 0).toFixed(2), 12, y); y -= 18;
  add('Paid: Tk ' + Number(data.paid || 0).toFixed(2), 11, y); y -= 16;
  add('Due: Tk ' + Number(data.due || 0).toFixed(2), 12, y); y -= 24;
  add('Thank you for shopping with Goince!', 11, y); y -= 16;
  add('This is a computer-generated invoice and does not require a signature.', 9, y);

  let content = '';
  for (const l of lines) {
    content += 'BT /F1 ' + l.size + ' Tf 48 ' + l.y + ' Td (' + l.text + ') Tj ET\n';
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + 'endstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xrefPos = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}

module.exports = { buildInvoicePdf };
