import { test } from "node:test";
import assert from "node:assert/strict";
import {
  syncCatalog,
  resolveSigningSecret,
  digest,
} from "../../scripts/billing-catalog.mjs";
import { normalizeBilling } from "../../src/shared/billing-config.ts";
function fixture() {
  const products = new Map(),
    prices = new Map(),
    portals = new Map();
  let lost = false,
    live = false;
  const stripe = {
    accounts: { retrieveCurrent: async () => ({ id: "acct_fixture" }) },
    balance: { retrieve: async () => ({ livemode: live }) },
    products: {
      retrieve: async (id) => {
        if (!products.has(id))
          throw Object.assign(new Error("missing"), { statusCode: 404 });
        return products.get(id);
      },
      create: async (p) => {
        products.set(p.id, p);
        return p;
      },
    },
    prices: {
      list: async (p) => ({
        data: [...prices.values()].filter((x) =>
          p.lookup_keys.includes(x.lookup_key),
        ),
      }),
      create: async (p) => {
        const price = {
          ...p,
          id: `price_${prices.size}`,
          active: true,
          recurring: p.recurring ? { ...p.recurring, interval_count: 1 } : null,
        };
        prices.set(price.id, price);
        if (lost) {
          lost = false;
          throw new Error("response lost");
        }
        return price;
      },
    },
    billingPortal: {
      configurations: {
        list: async function* () {
          yield* portals.values();
        },
        retrieve: async (id) => portals.get(id),
        create: async (p) => {
          const value = { ...p, id: `bpc_${portals.size}` };
          portals.set(value.id, value);
          return value;
        },
        update: async (id, p) => {
          portals.set(id, { ...p, id });
          return portals.get(id);
        },
      },
    },
  };
  let saved;
  const save = async (state, mappings) => {
    saved = { state, mappings };
  };
  save.origin = "https://starter.example";
  return {
    stripe,
    save,
    products,
    prices,
    portals,
    get saved() {
      return saved;
    },
    loseResponse() {
      lost = true;
    },
    setLive() {
      live = true;
    },
  };
}
test("signing readiness rejects a supplied secret unrelated to the created endpoint or stored fingerprint", () => {
  assert.throws(
    () =>
      resolveSigningSecret({ provided: "whsec_wrong", created: "whsec_owned" }),
    /does not match/,
  );
  assert.throws(
    () =>
      resolveSigningSecret({
        provided: "whsec_wrong",
        expectedHash: digest("whsec_owned"),
      }),
    /fingerprint/,
  );
  assert.equal(
    resolveSigningSecret({
      provided: "whsec_owned",
      created: "whsec_owned",
      expectedHash: digest("whsec_owned"),
    }),
    "whsec_owned",
  );
});
const billing = normalizeBilling({
  enabled: true,
  currency: "usd",
  monthly: { amountMinor: 990, credits: 100 },
  creditPack: { amountMinor: 490, credits: 50 },
});
test("catalog first/repeated sync is scoped, preserves historical prices and versions entitlement changes", async () => {
  const f = fixture(),
    args = { slug: "demo", environment: "dev", billing, save: f.save };
  const first = await syncCatalog(f.stripe, args);
  await syncCatalog(f.stripe, { ...args, previous: first.state });
  assert.equal(f.prices.size, 2);
  assert.equal(f.products.size, 2);
  assert.equal(f.portals.size, 1);
  assert.equal(
    f.portals.values().next().value.features.subscription_update.enabled,
    false,
  );
  const changed = normalizeBilling({
    enabled: true,
    currency: "usd",
    monthly: { amountMinor: 1090, credits: 200 },
    creditPack: { amountMinor: 490, credits: 50 },
  });
  await syncCatalog(f.stripe, {
    ...args,
    billing: changed,
    previous: first.state,
  });
  assert.equal(f.prices.size, 3);
  assert.equal([...f.prices.values()][0].unit_amount, 990);
  changed.plans[0].credits = 250;
  await syncCatalog(f.stripe, {
    ...args,
    billing: changed,
    previous: first.state,
  });
  assert.equal(f.prices.size, 4);
});
test("recovers a lost create response from stable version lookup", async () => {
  const f = fixture(),
    args = { slug: "demo", environment: "dev", billing, save: f.save };
  f.loseResponse();
  await assert.rejects(syncCatalog(f.stripe, args), /response lost/);
  await syncCatalog(f.stripe, args);
  assert.equal(f.prices.size, 2);
});
test("wrong live mode and account ownership fail before mutation", async () => {
  const f = fixture();
  f.setLive();
  await assert.rejects(
    syncCatalog(f.stripe, {
      slug: "demo",
      environment: "dev",
      billing,
      save: f.save,
    }),
    /test mode/,
  );
  assert.equal(f.products.size, 0);
  const g = fixture(),
    args = { slug: "demo", environment: "dev", billing, save: g.save };
  const first = await syncCatalog(g.stripe, args);
  await assert.rejects(
    syncCatalog(g.stripe, {
      ...args,
      previous: { ...first.state, namespace: "different" },
    }),
    /account\/environment/,
  );
  g.portals.get(first.state.portal_id).metadata.namespace = "unrelated";
  await assert.rejects(
    syncCatalog(g.stripe, { ...args, previous: first.state }),
    /ownership/,
  );
});
