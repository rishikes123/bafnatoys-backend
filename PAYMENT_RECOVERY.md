# Razorpay order recovery

The checkout now has three recovery layers:

1. The web/mobile client finalizes the order immediately after payment.
2. Razorpay sends a signed webhook if the client disconnects.
3. The backend checks unfinished paid checkouts every two minutes.

## Production webhook setup

1. Generate a long random secret and add it to the backend environment:

   `RAZORPAY_WEBHOOK_SECRET=<random-secret>`

2. In Razorpay Dashboard, add this webhook URL:

   `https://api.bafnatoys.com/api/payments/webhook`

3. Use the exact same secret in Razorpay Dashboard.

4. Enable these events:

   - `payment.captured`
   - `order.paid`

5. Deploy/restart the backend after adding the environment variable.

The webhook handler rejects invalid signatures. Finalization is idempotent, so
client retries, duplicate webhooks, and the scheduled worker cannot create
multiple orders for one persisted checkout.
