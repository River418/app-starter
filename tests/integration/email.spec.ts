import { afterEach, expect, it, vi } from "vitest";
import config from "../../app.config";
import { sendTransactionalEmail } from "../../src/server/email/send";
afterEach(() => {
  config.email = undefined;
  vi.restoreAllMocks();
});
it("requires configured sender/key and sends normalized text and HTML with provider idempotency", async () => {
  const payload = {
    to: "member@example.test",
    subject: "Your invitation",
    text: "Open your private invitation",
    html: "<p>Open your private invitation</p>",
    operationId: crypto.randomUUID(),
  };
  await expect(
    sendTransactionalEmail({ APP_ENV: "test" }, payload),
  ).rejects.toThrow(/configured/);
  config.email = {
    sending: {
      domain: "notify.example.test",
      from: "App <hello@notify.example.test>",
      replyTo: "support@example.test",
    },
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ id: "email_provider_1" }));
  await expect(
    sendTransactionalEmail(
      { APP_ENV: "test", RESEND_API_KEY: " re_local_fixture " },
      payload,
    ),
  ).resolves.toEqual({ id: "email_provider_1" });
  const [url, request] = fetch.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect((request!.headers as Record<string, string>).Authorization).toBe(
    "Bearer re_local_fixture",
  );
  const body = JSON.parse(request!.body as string);
  expect(body).toMatchObject({
    from: "App <hello@notify.example.test>",
    to: ["member@example.test"],
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    reply_to: "support@example.test",
  });
  expect(
    (request!.headers as Record<string, string>)["Idempotency-Key"],
  ).toContain(payload.operationId);
});
it("propagates provider failure, rejects header injection and never reports false delivery success", async () => {
  config.email = {
    sending: {
      domain: "notify.example.test",
      from: "App <hello@notify.example.test>",
    },
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { message: "Provider secret details withheld" },
      { status: 503 },
    ),
  );
  const payload = {
    to: "member@example.test",
    subject: "Hello",
    text: "Body",
    operationId: crypto.randomUUID(),
  };
  await expect(
    sendTransactionalEmail(
      { APP_ENV: "test", RESEND_API_KEY: "re_local" },
      payload,
    ),
  ).rejects.toThrow("Email provider rejected delivery");
  await expect(
    sendTransactionalEmail(
      { APP_ENV: "test", RESEND_API_KEY: "re_local" },
      { ...payload, subject: "Hello\r\nBcc: attacker@example.test" },
    ),
  ).rejects.toThrow(/Invalid/);
});
