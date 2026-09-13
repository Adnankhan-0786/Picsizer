# PicSizer Pro

PicSizer is a browser-first image/PDF utility with a Node.js + Express backend for Razorpay payment verification.

## Features
- Image format conversion: JPG, PNG, WebP, PDF
- Image resize/compress with target-size optimization
- PDF → image with DPI/page-range controls
- PDF compression presets
- ZIP download for multiple outputs
- Razorpay ₹5 download unlock
- Server-side Razorpay order creation + signature verification
- No user files are uploaded to the backend; processing remains in the browser

## Run locally
1. Install Node.js 18+.
2. Copy `.env.example` to `.env`.
3. Put your Razorpay **test** Key ID and Key Secret in `.env`.
4. Run:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:4000`.

Use Razorpay Test Mode while developing. For production, replace the test credentials with your live credentials and deploy behind HTTPS.

## Payment flow
The browser asks the backend to create a Razorpay order. Razorpay Checkout handles payment, then the backend verifies the returned signature before the UI unlocks downloads.


## Production hosting
This project is a Node.js + Express app. Deploy the whole project (not only the `public` folder) to a Node-compatible host.
Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and optionally `PAYMENT_AMOUNT`, `CURRENCY`, `APP_NAME` as environment variables.
The QR image is embedded into the frontend, so it does not depend on a relative `/support-qr.png` path and remains visible after deployment.
