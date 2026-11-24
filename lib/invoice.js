// Invoice helpers shared by the admin invoices page, the print invoice,
// the PDF generator and the email/WhatsApp senders.
// Invoice numbers are a series derived from the order id — no separate
// invoices table exists; an invoice IS an order (GOINCE-00035 = order #35).
function invoiceNo(orderId) {
  return 'GOINCE-' + String(orderId).padStart(5, '0');
}

// How much of an order has actually been paid.
// Sources, in order of trust: advance payments recorded by the admin, then
// COD cash marked collected, then payment_status = Paid. This deliberately
// does NOT rely on payment_status alone: a collected COD order whose
// payment_status is still Unpaid (seen live on order #35) must still count
// as paid, otherwise the invoice email/PDF would ask the customer to pay
// money they already handed over.
function paidAmount(order, advancesTotal) {
  const total = Number(order.total_amount || 0);
  const adv = Number(advancesTotal || 0);
  if (order.payment_status === 'Paid') return Math.max(adv, total);
  let paid = adv;
  if (order.cod_collected) paid = Math.max(paid, total);
  return Math.min(paid, total);
}

// What the customer still owes. Cancelled orders owe nothing.
function dueAmount(order, advancesTotal) {
  if (order.status === 'Cancelled') return 0;
  return Math.max(0, Number(order.total_amount || 0) - paidAmount(order, advancesTotal));
}

module.exports = { invoiceNo, paidAmount, dueAmount };
