require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const PAYMENT_AMOUNT = Number(process.env.PAYMENT_AMOUNT || 500); // paise = ₹5
const CURRENCY = process.env.CURRENCY || 'INR';
const APP_NAME = process.env.APP_NAME || 'PicSizer';

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('Razorpay keys are not configured. Add them to .env before using live/test payments.');
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_missing',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'missing'
});

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: APP_NAME, currency: CURRENCY, amount: PAYMENT_AMOUNT });
});

app.get('/api/payment/config', (_req, res) => {
  res.json({
    keyId: process.env.RAZORPAY_KEY_ID || '',
    amount: PAYMENT_AMOUNT,
    currency: CURRENCY,
    name: APP_NAME,
    description: 'PicSizer download unlock'
  });
});

app.post('/api/payment/create-order', async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: PAYMENT_AMOUNT,
      currency: CURRENCY,
      receipt: `picsizer_${Date.now()}`,
      notes: { purpose: 'download_unlock' }
    });
    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID || ''
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Unable to create payment order.' });
  }
});

app.post('/api/payment/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ verified: false, error: 'Missing payment verification fields.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const verified = crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(razorpay_signature)
  );

  if (!verified) return res.status(400).json({ verified: false, error: 'Invalid payment signature.' });

  res.json({ verified: true, paymentId: razorpay_payment_id, orderId: razorpay_order_id });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${APP_NAME} server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
