// Admin-er phone/browser-e Push Notification pathanor jonno helper.
// Kaj korte hole .env file e VAPID_PUBLIC_KEY ebong VAPID_PRIVATE_KEY diye rakhte hobe
// (README-e ei key duita deya ache, aage theke generate kora — notun kore banate hobe na).
// Firebase ba onno kono external account lagbe na, eta pure Web Push standard.

const webpush = require('web-push');

let configured = false;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@goince.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

// Shob subscribed admin device-e ekta notification pathay.
// Kono device unsubscribe/expired hoye gele (410/404 error), database theke
// otoke automatic mucheo dey — jate porer bar r try na kore.
async function notifyAdmins(db, payload) {
  if (!configured) return; // .env e VAPID key setup na thakle chup chap skip

  let subs;
  try {
    [subs] = await db.query('SELECT * FROM push_subscriptions');
  } catch (err) {
    console.error('Push subscriptions load error:', err.message);
    return;
  }

  const data = JSON.stringify(payload);

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth }
    };
    try {
      await webpush.sendNotification(subscription, data);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await db.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]).catch(() => {});
      } else {
        console.error('Push notification send error:', err.message);
      }
    }
  }
}

module.exports = { notifyAdmins, isConfigured: () => configured };
