/* =========================================================
   PAYWALL (Razorpay checkout unlock)
   ========================================================= */
let paymentUnlocked = false;

function lockResultsForPayment(){
  const listEl = $("#results-list");
  const overlay = $("#paywall-overlay");
  listEl.classList.add("locked");
  overlay.classList.add("show");
  $("#download-zip").disabled = true;
  paymentUnlocked = false;
  $("#payment-status").textContent = "Payment is required before download.";
}

function unlockResults(){
  paymentUnlocked = true;
  $("#results-list").classList.remove("locked");
  $("#paywall-overlay").classList.remove("show");
  $("#download-zip").disabled = false;
}

async function startPayment(){
  const btn = $("#paywall-unlock");
  const status = $("#payment-status");
  btn.disabled = true;
  status.textContent = "Creating secure payment order…";
  try {
    const orderRes = await fetch("/api/payment/create-order", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({}) });
    const order = await orderRes.json();
    if (!orderRes.ok || !order.id || !order.keyId) throw new Error(order.error || "Payment configuration is incomplete.");

    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "PicSizer",
      description: "Download unlock",
      order_id: order.id,
      theme: { color: "#2C5F8A" },
      handler: async function(response){
        status.textContent = "Verifying payment…";
        const verifyRes = await fetch("/api/payment/verify", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify(response)
        });
        const verified = await verifyRes.json();
        if (!verifyRes.ok || !verified.verified) throw new Error(verified.error || "Payment verification failed.");
        status.textContent = "Payment verified ✓";
        unlockResults();
      },
      modal: { ondismiss: () => { status.textContent = "Payment cancelled."; btn.disabled = false; } }
    };

    const rzp = new Razorpay(options);
    rzp.on("payment.failed", function(resp){
      status.textContent = resp.error?.description || "Payment failed. Please try again.";
      btn.disabled = false;
    });
    rzp.open();
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "Could not start payment.";
    btn.disabled = false;
  }
}
$("#paywall-unlock").addEventListener("click", startPayment);

