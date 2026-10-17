import type { AppConfig } from "./config";
const domainPattern =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function mailbox(value: string) {
  const text = value.trim();
  if (/[\r\n]/.test(text)) throw new Error("Invalid email header");
  const address = text.match(/^[^<>]*<([^<>]+)>$/)?.[1] || text;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) || address.length > 254)
    throw new Error("Invalid email address");
  return address;
}
export function normalizeEmail(value?: AppConfig["email"]) {
  if (!value) return {};
  const sending = value.sending
    ? {
        ...value.sending,
        domain: value.sending.domain.trim().toLowerCase(),
        from: value.sending.from.trim(),
        replyTo: value.sending.replyTo?.trim(),
      }
    : undefined;
  const forwarding = value.forwarding
    ? {
        domain: value.forwarding.domain.trim().toLowerCase(),
        aliases: [
          ...new Set(
            value.forwarding.aliases.map((a) => a.trim().toLowerCase()),
          ),
        ],
      }
    : undefined;
  if (
    sending &&
    (!domainPattern.test(sending.domain) ||
      mailbox(sending.from).split("@")[1].toLowerCase() !== sending.domain)
  )
    throw new Error("Invalid sending domain or From address");
  if (sending?.replyTo) mailbox(sending.replyTo);
  if (
    forwarding &&
    (!domainPattern.test(forwarding.domain) ||
      !forwarding.aliases.length ||
      forwarding.aliases.length > 20 ||
      forwarding.aliases.some((a) => !/^[-a-z0-9._+]{1,64}$/.test(a)))
  )
    throw new Error("Invalid forwarding domain or aliases");
  return { sending, forwarding };
}
