// Deterministic external-provider substitute. Never used by cloud deployments or browser route interception.
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
const origin = "http://localhost:55431",
  appOrigin = "http://localhost:5173";
const sessions = new Map(),
  intents = new Map(),
  charges = new Map();
const list = (data) => ({
  object: "list",
  data,
  has_more: false,
  url: "/v1/local",
});
export function startStripeSubstitute() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const params = new URLSearchParams(raw);
      const send = (data) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      };
      if (url.pathname === "/pay") {
        const s = sessions.get(url.searchParams.get("session"));
        if (!s) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "text/html;charset=utf-8");
        res.end(
          `<!doctype html><title>Local payment simulator</title><h1>Local payment simulator</h1><p>No card details. No charge. This is not Stripe Sandbox.</p><form method="post" action="/complete"><input type="hidden" name="session" value="${s.id}"><button>Simulate successful payment</button></form>`,
        );
        return;
      }
      async function event(type, s) {
        const payload = JSON.stringify({
            id: `evt_${randomUUID()}`,
            type,
            livemode: false,
            data: { object: { id: s.id } },
          }),
          timestamp = Math.floor(Date.now() / 1000),
          signature = createHmac("sha256", "whsec_local_browser_fixture")
            .update(`${timestamp}.${payload}`)
            .digest("hex");
        const response = await fetch(`${appOrigin}/api/billing/webhook`, {
          method: "POST",
          headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
          body: payload,
        });
        if (!response.ok)
          throw new Error("Application rejected local provider event");
      }
      if (url.pathname === "/expire" && req.method === "POST") {
        const session = sessions.get(params.get("session"));
        if (!session) throw new Error("Missing local session");
        session.status = "expired";
        send({ ok: true });
        return;
      }
      if (url.pathname === "/complete") {
        const s = sessions.get(params.get("session"));
        if (!s) throw new Error("Missing local session");
        s.status = "complete";
        s.payment_status = "paid";
        await event("checkout.session.completed", s);
        res.statusCode = 303;
        res.setHeader("Location", s.success_url);
        res.end();
        return;
      }
      if (url.pathname === "/refund" && req.method === "POST") {
        const s = sessions.get(params.get("session"));
        if (!s) throw new Error("Missing local session");
        const charge = charges.get(`ch_${s.id}`);
        charge.refunded = true;
        charge.amount_refunded = charge.amount;
        await event("charge.refunded", charge);
        send({ ok: true });
        return;
      }
      if (
        req.headers.authorization !== "Bearer sk_test_local_browser_fixture"
      ) {
        res.statusCode = 401;
        send({
          error: {
            type: "authentication_error",
            message: "Local test credentials required",
          },
        });
        return;
      }
      if (url.pathname === "/v1/customers" && req.method === "POST") {
        send({
          id: `cus_${params.get("metadata[user_id]")}`,
          object: "customer",
          metadata: {
            namespace: params.get("metadata[namespace]"),
            user_id: params.get("metadata[user_id]"),
          },
        });
        return;
      }
      if (url.pathname === "/v1/subscriptions") {
        send(list([]));
        return;
      }
      if (url.pathname === "/v1/checkout/sessions" && req.method === "POST") {
        const key = req.headers["idempotency-key"];
        const prior = [...sessions.values()].find((s) => s.key === key);
        if (prior) {
          send(prior);
          return;
        }
        const id = `cs_${randomUUID().replaceAll("-", "")}`,
          metadata = Object.fromEntries(
            ["namespace", "user_id", "order_id"].map((k) => [
              k,
              params.get(`metadata[${k}]`),
            ]),
          );
        const session = {
          id,
          object: "checkout.session",
          key,
          livemode: false,
          client_reference_id: params.get("client_reference_id"),
          customer: params.get("customer"),
          metadata,
          mode: params.get("mode"),
          status: "open",
          payment_status: "unpaid",
          currency: "usd",
          amount_subtotal: 490,
          amount_total: 490,
          payment_intent: `pi_${id}`,
          subscription: null,
          url: `${origin}/pay?session=${id}`,
          success_url: params.get("success_url"),
        };
        sessions.set(id, session);
        const charge = {
          id: `ch_${id}`,
          object: "charge",
          livemode: false,
          customer: session.customer,
          payment_intent: session.payment_intent,
          amount: 490,
          refunded: false,
          amount_refunded: 0,
          disputed: false,
        };
        charges.set(charge.id, charge);
        intents.set(session.payment_intent, {
          id: session.payment_intent,
          object: "payment_intent",
          livemode: false,
          customer: session.customer,
          status: "succeeded",
          currency: "usd",
          amount_received: 490,
          metadata,
          latest_charge: charge,
        });
        send(session);
        return;
      }
      if (url.pathname === "/v1/checkout/sessions") {
        send(list([...sessions.values()]));
        return;
      }
      if (url.pathname.endsWith("/line_items")) {
        send(list([{ price: { id: "price_e2e_creditPack" }, quantity: 1 }]));
        return;
      }
      if (url.pathname.startsWith("/v1/checkout/sessions/")) {
        send(sessions.get(url.pathname.split("/").at(-1)));
        return;
      }
      if (url.pathname.startsWith("/v1/payment_intents/")) {
        send(intents.get(url.pathname.split("/").at(-1)));
        return;
      }
      if (url.pathname.startsWith("/v1/charges/")) {
        send(charges.get(url.pathname.split("/").at(-1)));
        return;
      }
      if (url.pathname === "/v1/refunds") {
        const charge = charges.get(url.searchParams.get("charge"));
        send(
          list([
            {
              id: "re_local",
              status: "succeeded",
              amount: charge?.amount_refunded || 0,
            },
          ]),
        );
        return;
      }
      res.statusCode = 404;
      send({
        error: {
          type: "invalid_request_error",
          message: "Unsupported local provider operation",
        },
      });
    } catch {
      res.statusCode = 500;
      res.end(
        '{"error":{"type":"api_error","message":"Local payment simulator failed"}}',
      );
    }
  });
  return new Promise((accept, reject) => {
    server.on("error", reject);
    server.listen(55431, "127.0.0.1", () => accept(server));
  });
}
