import { HTTPException } from "hono/http-exception";
import config from "../../../app.config";
import { normalizeEmail, mailbox } from "../../shared/email-config";
import type { Bindings } from "../types";
export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  operationId: string;
}
export async function sendTransactionalEmail(
  env: Pick<Bindings, "APP_ENV" | "RESEND_API_KEY">,
  message: TransactionalEmail,
) {
  const sender = normalizeEmail(config.email).sending,
    key = env.RESEND_API_KEY?.trim();
  if (!sender || !key)
    throw new HTTPException(503, {
      message: "Email sender and key are not configured",
    });
  const to = mailbox(message.to);
  if (
    to !== message.to.trim() ||
    /[\r\n]/.test(message.subject) ||
    !message.subject.trim() ||
    message.subject.length > 200 ||
    !message.text ||
    message.text.length > 100000 ||
    (message.html?.length || 0) > 100000 ||
    !/^[-a-zA-Z0-9_.:]{1,128}$/.test(message.operationId)
  )
    throw new Error("Invalid transactional email");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `email:${config.slug}:${env.APP_ENV}:${message.operationId}`,
    },
    body: JSON.stringify({
      from: sender.from,
      to: [to],
      subject: message.subject.trim(),
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HTTPException(502, {
      message: "Email provider rejected delivery",
    });
  const body = (await response.json()) as { id?: string };
  if (!body.id)
    throw new HTTPException(502, {
      message: "Email provider rejected delivery",
    });
  // Provider acceptance is not inbox delivery. Do not log private links, recipients, payloads or provider errors.
  return { id: body.id };
}
