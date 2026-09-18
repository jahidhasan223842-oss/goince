// Live Chat: customer side. chat_identifier (cookie theke asha) diye
// conversation track kora hoy, jate session/browser bondho korleo
// (ba server restart holeo) purono chat history thake jay.
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Ekta conversation ber kora, na thakle notun toiri kora
async function getOrCreateConversation(chatId, req) {
  const [rows] = await db.query('SELECT * FROM chat_conversations WHERE chat_identifier = ?', [chatId]);
  if (rows.length > 0) return rows[0];

  const customerName = req.session.userName || 'Guest';
  const userId = req.session.userId || null;
  const [result] = await db.query(
    'INSERT INTO chat_conversations (chat_identifier, customer_name, user_id) VALUES (?, ?, ?)',
    [chatId, customerName, userId]
  );
  return { id: result.insertId, chat_identifier: chatId, customer_name: customerName, user_id: userId };
}

// ---------- GET MESSAGES (polling diye customer er widget ei call kore) ----------
router.get('/chat/messages', async (req, res) => {
  try {
    const [convRows] = await db.query('SELECT * FROM chat_conversations WHERE chat_identifier = ?', [req.chatId]);
    if (convRows.length === 0) {
      return res.json({ messages: [] }); // Ekhono kono message pathay ni, tai conversation nei
    }
    const [messages] = await db.query(
      'SELECT sender, message, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [convRows[0].id]
    );
    res.json({ messages });
  } catch (err) {
    console.error('Chat messages fetch error:', err);
    res.status(500).json({ messages: [] });
  }
});

// ---------- SEND MESSAGE (customer theke) ----------
router.post('/chat/send', async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message khali thakte parbe na' });

    const conversation = await getOrCreateConversation(req.chatId, req);

    await db.query(
      'INSERT INTO chat_messages (conversation_id, sender, message) VALUES (?, ?, ?)',
      [conversation.id, 'customer', message]
    );
    await db.query('UPDATE chat_conversations SET last_message_at = NOW() WHERE id = ?', [conversation.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Chat send error:', err);
    res.status(500).json({ error: 'Message pathano jay ni' });
  }
});

module.exports = router;
