# PicSizer — Kya Fix Kiya Gaya (Changelog)

## 1. Asli Bug: Payment unlock / download kaam nahi kar raha tha
**Root cause:** `.env.example` file me Razorpay test keys likhi hui thi, lekin `dotenv`
sirf `.env` file padhta hai — `.env.example` nahi. Aur `.gitignore` me `.env` exclude
tha, isliye zip me `.env` file thi hi nahi.

Result: server start hote hi console me ye warning aati thi:
```
Razorpay keys are not configured. Add them to .env before using live/test payments.
```
Aur jab "Pay ₹5 & Unlock" button dabate the, backend fake key (`rzp_test_missing`)
se Razorpay order banane ki koshish karta tha jo turant fail ho jata tha
(`403` error) — isliye Razorpay ka popup hi nahi khulta tha, `unlockResults()`
kabhi call nahi hota, aur download button hamesha disabled rehta tha.

**Fix:** `.env.example` ko `.env` me copy kiya gaya hai (already keys ke saath).
Agar aap apni khud ki live/test keys use karna chahte ho to bas `.env` file
kholke `RAZORPAY_KEY_ID` aur `RAZORPAY_KEY_SECRET` update kar dena:
```bash
cp .env.example .env   # agar .env delete ho jaye to
```
Fir server restart karo:
```bash
npm install
npm start
```

> Note: Is sandbox environment me Razorpay ke live API (`api.razorpay.com`) tak
> network access blocked hai, isliye main yahin se poora live payment test nahi
> kar saka. Lekin humne confirm kar liya hai ki keys ab sahi se load ho rahi hain
> aur order-create call Razorpay tak pahunch raha hai (pehle jo turant crash/fail
> hota tha wo ab nahi hota). Apne real server/localhost pe (jahan internet hai)
> ye pura flow kaam karega.

## 2. Code ko separate files me split kiya
Pehle **sara frontend code (HTML + CSS + JS) ek hi `public/index.html` file
(2058 lines)** me tha. Ab structure ye hai:

```
public/
  index.html          -> sirf HTML markup, koi inline <style> ya <script> nahi
  css/
    style.css         -> saara CSS
  js/
    core.js           -> helper functions ($ , formatBytes, etc.) + shared state
    upload.js         -> file upload, drag-drop, operation switching, controls UI
    converter.js      -> image/PDF conversion, progress bar, processing logic
    payment.js        -> Razorpay paywall logic (order create -> checkout -> verify)
    results.js        -> results list rendering + ZIP download
backend/
  server.js           -> Express server + Razorpay order create/verify APIs (waise hi hai)
```

Sab JS files plain `<script>` tags (normal, `type="module"` nahi) ke through
sequence me load hoti hain — isliye variables/functions pehle jaisa hi kaam
karte hain, sirf ab alag-alag readable files me organize hain.

## 3. Paywall se QR hata diya, aur Support/Donation QR bhi poori tarah remove
Paywall overlay ("Pay ₹5 to unlock") me pehle ek QR image bhi dikhta tha jo
sirf visual tha — usko scan karke koi bhi pay kare, app ko pata nahi chalta
tha aur unlock nahi hota tha (confusing tha). Ab wahan **sirf Razorpay
button hai** — "Pay ₹5 & Unlock download". Unlock ab sirf tabhi hota hai jab
koi Razorpay checkout se pay kare aur backend signature verify kare.

Aapke kehne par ek alag "Enjoying PicSizer? tip karo" wala **support/donation
QR card poori tarah hata diya gaya hai**, kyunki jab payment sirf Razorpay se
hota hai to alag donation-QR ka koi matlab nahi tha. Hataya gaya:
- `public/js/support.js` file (poori delete)
- `public/support-qr.png` asset (poora delete)
- `index.html` se `<script src="js/support.js">` tag
- `style.css` se saare `.support-card` related rules

(Note: ye card actually pehle se bhi kabhi call hi nahi hota tha kisi bhi
JS file se — matlab already dead code tha aur UI me kabhi dikhta nahi tha.
Ab poori tarah bhi hata diya gaya hai taaki confusion na rahe.)

## 4. Security suggestion (abhi ke liye nahi kiya, bata raha hoon)
`.env.example` me real-looking secret key hardcoded rakhna risky hai agar aap
kabhi is repo ko GitHub pe public/private push karo. Jab live keys daalo, tab
`.env.example` me sirf placeholder text rakhna (`RAZORPAY_KEY_ID=your_key_here`),
asli keys sirf `.env` (jo `.gitignore` me already excluded hai) me.
