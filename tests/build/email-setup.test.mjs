import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureDnsRecord, setupEmail } from "../../scripts/email-setup.mjs";
test("DNS synchronization reuses exact TXT/MX/CNAME records and refuses unrelated collisions", async () => {
  const records = [];
  const cf = async (path, method = "GET", body) => {
    if (method === "GET")
      return records.filter(
        (r) =>
          !path.includes("name=") ||
          r.name === new URL("https://cf.test" + path).searchParams.get("name"),
      );
    records.push({ ...body, id: String(records.length) });
    return records.at(-1);
  };
  for (const record of [
    { type: "TXT", name: "key.notify.example.test", content: "verification" },
    {
      type: "MX",
      name: "send.notify.example.test",
      content: "feedback.example.test",
      priority: 10,
    },
    {
      type: "CNAME",
      name: "spf.notify.example.test",
      content: "spf.provider.test",
    },
  ]) {
    await ensureDnsRecord(cf, "zone_fixture", record);
    await ensureDnsRecord(cf, "zone_fixture", record);
  }
  assert.equal(records.length, 3);
  await assert.rejects(
    ensureDnsRecord(cf, "zone_fixture", {
      type: "CNAME",
      name: "spf.notify.example.test",
      content: "foreign.test",
    }),
    /conflict/,
  );
});
test("routing with pending destination stays pending and does not resend verification or create a rule", async () => {
  const mutations = [];
  const cf = async (path, method = "GET", body) => {
    if (method !== "GET") {
      mutations.push(path);
      return {};
    }
    if (path.includes("/addresses"))
      return [
        {
          id: "destination_fixture",
          email: "owner@example.test",
          verified: null,
        },
      ];
    if (path.startsWith("/zones?"))
      return [
        {
          id: "zone_fixture",
          name: "example.test",
          account: { id: "account_fixture" },
        },
      ];
    if (path.includes("/dns_records")) return [];
    if (path.endsWith("/email/routing/dns")) return { records: [] };
    if (path.endsWith("/email/routing")) return { enabled: true };
    return [];
  };
  const result = await setupEmail({
    cf,
    resend: async () => {
      throw Error("not needed");
    },
    accountId: "account_fixture",
    email: { forwarding: { domain: "example.test", aliases: ["support"] } },
    forwardTo: "owner@example.test",
    slug: "starter",
    environment: "dev",
  });
  assert.equal(result.forwarding, "pending_destination_verification");
  assert.equal(mutations.length, 0);
});
test("routing paginates at provider limit, reuses verified destination/rules and rejects subdomains or misconfigured DNS", async () => {
  const rules = [],
    mutations = [];
  let status = "ready",
    secondPage = 0;
  const destination = {
    id: "owned_destination",
    email: "owner@example.test",
    verified: "2026-10-17T00:00:00Z",
  };
  const cf = async (path, method = "GET", body) => {
    if (method !== "GET") {
      mutations.push(path);
      if (path.endsWith("/rules")) rules.push({ ...body, id: "rule_owned" });
      return {};
    }
    if (path.startsWith("/zones?"))
      return [
        {
          id: "zone_fixture",
          name: "example.test",
          account: { id: "account_fixture" },
        },
      ];
    if (path.includes("/addresses")) {
      const u = new URL("https://cf.test" + path);
      assert.equal(u.searchParams.get("per_page"), "50");
      if (u.searchParams.get("page") === "1")
        return Array.from({ length: 50 }, (_, i) => ({
          email: `other-${i}@example.test`,
          verified: null,
        }));
      secondPage++;
      return [destination];
    }
    if (path.includes("/dns_records")) return [];
    if (path.endsWith("/email/routing")) return { enabled: true, status };
    if (path.includes("/rules")) return rules;
    return [];
  };
  const args = {
    cf,
    resend: async () => {
      throw Error("not needed");
    },
    accountId: "account_fixture",
    email: { forwarding: { domain: "example.test", aliases: ["support"] } },
    forwardTo: "owner@example.test",
    slug: "starter",
    environment: "dev",
  };
  assert.equal((await setupEmail(args)).forwarding, "configured");
  assert.equal((await setupEmail(args)).forwarding, "configured");
  assert.equal(mutations.length, 1);
  assert.equal(secondPage, 2);
  await assert.rejects(
    setupEmail({
      ...args,
      email: {
        forwarding: { domain: "inbox.example.test", aliases: ["support"] },
      },
    }),
    /apex/,
  );
  status = "misconfigured";
  assert.equal((await setupEmail(args)).forwarding, "pending_dns_verification");
  assert.equal(rules.length, 1);
});
test("sending DNS honors provider CNAME responses and does not reverify an unchanged verified domain", async () => {
  const records = [],
    writes = [];
  const cf = async (path, method = "GET", body) => {
    if (path.startsWith("/zones?"))
      return [{ id: "zone", name: "example.test", account: { id: "account" } }];
    if (method === "GET") return records;
    records.push(body);
    return body;
  };
  const resend = async (path, method = "GET") => {
    if (method !== "GET") writes.push(path);
    if (path.startsWith("/domains?"))
      return {
        has_more: false,
        data: [{ id: "domain", name: "notify.example.test" }],
      };
    return {
      id: "domain",
      name: "notify.example.test",
      status: "verified",
      capabilities: { sending: "enabled", receiving: "disabled" },
      records: [{ type: "CNAME", name: "spf", value: "spf.provider.test" }],
    };
  };
  const args = {
    cf,
    resend,
    accountId: "account",
    email: {
      sending: {
        domain: "notify.example.test",
        from: "App <mail@notify.example.test>",
      },
    },
    slug: "starter",
    environment: "dev",
  };
  await setupEmail(args);
  await setupEmail(args);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "spf.notify.example.test");
  assert.equal(records[0].proxied, false);
  assert.deepEqual(writes, ["/domains/domain/verify"]);
});
