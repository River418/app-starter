import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import {
  request,
  user,
  password,
  trackUser,
  responseCookies,
  adminClient,
} from "./fixtures";
import { sha256 } from "../../src/server/auth/crypto";

test("administrator recovers an invited account after its original confirmation session was lost", async () => {
  const admin = await user("admin");
  const response = await request("/api/admin/invitations", {
    method: "POST",
    cookie: admin.cookie(),
    body: {
      operationId: crypto.randomUUID(),
      reason: "Pending recovery",
      email: `starter-${crypto.randomUUID()}@example.test`,
    },
  });
  const issued = (await response.json()) as { link: string; userId: string };
  trackUser(issued.userId);
  await request("/api/auth/confirm", {
    method: "POST",
    body: {
      type: "invite",
      tokenHash: new URL(issued.link).searchParams.get("token_hash"),
    },
  });
  const recovered = await request(
    `/api/admin/users/${issued.userId}/recovery`,
    {
      method: "POST",
      cookie: admin.cookie(),
      body: {
        operationId: crypto.randomUUID(),
        reason: "Lost browser session",
      },
    },
  );
  expect(recovered.status).toBe(201);
  const tokenHash = new URL(
    ((await recovered.json()) as { link: string }).link,
  ).searchParams.get("token_hash");
  const confirmed = await request("/api/auth/confirm", {
    method: "POST",
    body: { type: "recovery", tokenHash },
  });
  expect(confirmed.status).toBe(200);
  const cookie = responseCookies(confirmed);
  expect(
    (
      await request("/api/auth/complete", {
        method: "POST",
        cookie,
        body: { tokenHash, password },
      })
    ).status,
  ).toBe(200);
  expect((await request("/api/session", { cookie })).status).toBe(200);
});

test("recovery revocation refuses a false promise; pending invitation revocation blocks app activation", async () => {
  const admin = await user("admin");
  const member = await user();
  const recovery = await request(`/api/admin/users/${member.id}/recovery`, {
    method: "POST",
    cookie: admin.cookie(),
    body: { operationId: crypto.randomUUID(), reason: "Recovery test" },
  });
  const recoveryLink = (await recovery.json()) as { actionId: string };
  expect(
    (
      await request(`/api/admin/actions/${recoveryLink.actionId}/revoke`, {
        method: "POST",
        cookie: admin.cookie(),
        body: {
          operationId: crypto.randomUUID(),
          reason: "Do not promise token revocation",
        },
      })
    ).status,
  ).toBe(409);
  const response = await request("/api/admin/invitations", {
    method: "POST",
    cookie: admin.cookie(),
    body: {
      operationId: crypto.randomUUID(),
      reason: "Invite test",
      email: `starter-${crypto.randomUUID()}@example.test`,
    },
  });
  const invitation = (await response.json()) as {
    userId: string;
    actionId: string;
    link: string;
  };
  trackUser(invitation.userId);
  expect(
    (
      await request(`/api/admin/actions/${invitation.actionId}/revoke`, {
        method: "POST",
        cookie: admin.cookie(),
        body: {
          operationId: crypto.randomUUID(),
          reason: "Revoke pending access",
        },
      })
    ).status,
  ).toBe(200);
  const tokenHash = new URL(invitation.link).searchParams.get("token_hash");
  expect(
    (
      await request("/api/auth/confirm", {
        method: "POST",
        body: { tokenHash, type: "invite" },
      })
    ).status,
  ).toBe(410);
});

test("bootstrap status exists and rejects a missing/expired token", async () => {
  expect((await request("/api/auth/status")).status).toBe(200);
  const token = "expired-token-for-test";
  await env.DB.prepare(
    "INSERT INTO bootstrap (id,token_hash,expires_at) VALUES (1,?,?)",
  )
    .bind(await sha256(token), Date.now() - 1)
    .run();
  expect(
    (
      await request("/api/auth/bootstrap", {
        method: "POST",
        body: { token, email: "nobody@example.test", password },
      })
    ).status,
  ).toBe(410);
});
test("bootstrap atomically creates exactly one administrator and cannot replay", async () => {
  const token = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO bootstrap (id,token_hash,expires_at) VALUES (1,?,?)",
  )
    .bind(await sha256(token), Date.now() + 60000)
    .run();
  const body = {
    token,
    email: `starter-${crypto.randomUUID()}@example.test`,
    password,
  };
  const first = await request("/api/auth/bootstrap", { method: "POST", body });
  expect(first.status).toBe(201);
  const data = (await first.json()) as { userId: string };
  trackUser(data.userId);
  expect(
    (await request("/api/auth/bootstrap", { method: "POST", body })).status,
  ).toBe(409);
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM members WHERE role='admin'",
    ).first("n"),
  ).toBe(1);
});
test("getUser plus D1 membership rejects an outsider, ordinary member and cross-origin writes", async () => {
  const outsider = await user("member", false);
  expect(
    (await request("/api/session", { cookie: outsider.cookie() })).status,
  ).toBe(403);
  const member = await user();
  expect(
    (await request("/api/session", { cookie: member.cookie() })).status,
  ).toBe(200);
  expect(
    (await request("/api/admin/users", { cookie: member.cookie() })).status,
  ).toBe(403);
  expect(
    (
      await request("/api/admin/invitations", {
        method: "POST",
        cookie: member.cookie(),
        headers: { Origin: "https://evil.example" },
        body: {},
      })
    ).status,
  ).toBe(403);
  await env.DB.prepare("UPDATE members SET status='disabled' WHERE user_id=?")
    .bind(member.id)
    .run();
  expect(
    (await request("/api/session", { cookie: member.cookie() })).status,
  ).toBe(403);
});
test("invite has no application access before password completion, cannot replay and has audited idempotency", async () => {
  const admin = await user("admin");
  const operationId = crypto.randomUUID();
  const email = `starter-${crypto.randomUUID()}@example.test`;
  const response = await request("/api/admin/invitations", {
    method: "POST",
    cookie: admin.cookie(),
    body: { email, reason: "Test access", operationId },
  });
  expect(response.status).toBe(201);
  const issued = (await response.json()) as { link: string; userId: string };
  trackUser(issued.userId);
  const link = new URL(issued.link);
  const tokenHash = link.searchParams.get("token_hash")!;
  const duplicate = await request("/api/admin/invitations", {
    method: "POST",
    cookie: admin.cookie(),
    body: { email, reason: "Test access", operationId },
  });
  expect(duplicate.status).toBe(409); // one-time bearer is never stored for replay
  const confirm = await request("/api/auth/confirm", {
    method: "POST",
    body: { tokenHash, type: "invite" },
  });
  expect(confirm.status).toBe(200);
  const cookie = responseCookies(confirm);
  expect(cookie).not.toBe("");
  expect(confirm.headers.get("cache-control")).toContain("no-store");
  const resumed = await request("/api/auth/resume", {
    method: "POST",
    cookie,
    body: { tokenHash },
  });
  expect(resumed.status).toBe(200);
  expect(await resumed.json()).toMatchObject({ passwordRequired: true });
  expect((await request("/api/session", { cookie })).status).toBe(403);
  expect(
    (
      await request("/api/auth/complete", {
        method: "POST",
        cookie,
        body: { tokenHash, password },
      })
    ).status,
  ).toBe(200);
  expect((await request("/api/session", { cookie })).status).toBe(200);
  expect(
    (
      await request("/api/auth/confirm", {
        method: "POST",
        body: { tokenHash, type: "invite" },
      })
    ).status,
  ).toBe(410);
  const audits = await env.DB.prepare(
    "SELECT * FROM audit_log WHERE operation_id=?",
  )
    .bind(operationId)
    .all();
  expect(audits.results).toHaveLength(1);
  expect(JSON.stringify(audits.results)).not.toContain(tokenHash);
});
test("expired and revoked links cannot grant membership, recovery is restricted to its account", async () => {
  const admin = await user("admin");
  const member = await user();
  const other = await user();
  const body = { reason: "Lost access", operationId: crypto.randomUUID() };
  const response = await request(`/api/admin/users/${member.id}/recovery`, {
    method: "POST",
    cookie: admin.cookie(),
    body,
  });
  expect(response.status).toBe(201);
  const issued = (await response.json()) as { link: string };
  const tokenHash = new URL(issued.link).searchParams.get("token_hash")!;
  expect(
    (
      await request("/api/auth/complete", {
        method: "POST",
        cookie: other.cookie(),
        body: { tokenHash, password },
      })
    ).status,
  ).toBe(410);
  await env.DB.prepare(
    "UPDATE auth_actions SET expires_at=? WHERE token_hash=?",
  )
    .bind(Date.now() - 1, await sha256(tokenHash))
    .run();
  expect(
    (
      await request("/api/auth/confirm", {
        method: "POST",
        body: { tokenHash, type: "recovery" },
      })
    ).status,
  ).toBe(410);
  expect(
    (
      await request(`/api/admin/users/${member.id}/recovery`, {
        method: "POST",
        cookie: admin.cookie(),
        body,
      })
    ).status,
  ).toBe(409);
});
