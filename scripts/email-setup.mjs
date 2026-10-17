import { normalizeEmail, mailbox } from "../src/shared/email-config.ts";
const normalized = (value) =>
  String(value).replace(/^"|"$/g, "").replace(/\.$/, "");
export async function ensureDnsRecord(cf, zoneId, record) {
  if (!["TXT", "MX", "CNAME"].includes(record.type))
    throw new Error("Unsupported email DNS record type");
  const rows = await cf(
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(record.name)}&per_page=100`,
  );
  const same = rows.find(
    (r) =>
      r.type === record.type &&
      normalized(r.content) === normalized(record.content) &&
      (record.type !== "MX" || r.priority === record.priority),
  );
  if (same) return false;
  if (
    rows.some(
      (r) =>
        r.type === record.type || r.type === "CNAME" || record.type === "CNAME",
    )
  )
    throw new Error(
      "Email DNS conflict; preserve existing records and resolve it explicitly",
    );
  await cf(`/zones/${zoneId}/dns_records`, "POST", {
    ...record,
    ttl: 1,
    proxied: false,
    comment: "app-starter email setup",
  });
  return true;
}
async function zoneFor(cf, domain, accountId) {
  let name = domain;
  while (name.includes(".")) {
    const zones = await cf(
      `/zones?name=${encodeURIComponent(name)}&per_page=50`,
    );
    const zone = zones.find(
      (z) => z.name === name && z.account.id === accountId,
    );
    if (zone) return zone;
    name = name.split(".").slice(1).join(".");
  }
  throw new Error(
    "Email domain must be in the selected Cloudflare account with readable zone access",
  );
}
async function pages(api, path) {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await api(
      `${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=50`,
    );
    all.push(...rows);
    if (rows.length < 50) return all;
  }
  throw new Error("Email setup pagination exceeds bounded operator limit");
}
export async function setupEmail({
  cf,
  resend,
  accountId,
  email,
  forwardTo,
  slug,
  environment,
}) {
  const normalizedEmail = normalizeEmail(email),
    status = {};
  if (normalizedEmail.sending) {
    const sender = normalizedEmail.sending,
      zone = await zoneFor(cf, sender.domain, accountId);
    let after, found;
    for (let page = 0; page < 100; page++) {
      const list = await resend(
        `/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      );
      found = list.data.find((d) => d.name === sender.domain);
      if (found || !list.has_more) break;
      after = list.data.at(-1)?.id;
      if (!after) throw new Error("Invalid Resend pagination");
    }
    if (!found)
      found = await resend("/domains", "POST", {
        name: sender.domain,
        capabilities: { sending: "enabled", receiving: "disabled" },
      });
    let domain = await resend(`/domains/${found.id}`),
      changed = false;
    if (
      domain.name !== sender.domain ||
      domain.capabilities?.receiving === "enabled"
    )
      throw new Error("Sending-domain ownership or receiving mode conflict");
    for (const record of domain.records) {
      const name =
        record.name === sender.domain ||
        record.name.endsWith(`.${sender.domain}`)
          ? record.name
          : `${record.name}.${sender.domain}`;
      changed =
        (await ensureDnsRecord(cf, zone.id, {
          type: record.type,
          name,
          content: record.value,
          ...(record.priority !== undefined
            ? { priority: record.priority }
            : {}),
        })) || changed;
    }
    if (domain.status !== "verified" || changed) {
      await resend(`/domains/${domain.id}/verify`, "POST");
      domain = await resend(`/domains/${domain.id}`);
    }
    status.sending =
      domain.status === "verified" ? "verified" : "pending_dns_verification";
    status.domainId = domain.id;
  }
  if (normalizedEmail.forwarding) {
    const forwarding = normalizedEmail.forwarding;
    mailbox(forwardTo || "");
    const zone = await zoneFor(cf, forwarding.domain, accountId),
      apexOnly = forwarding.domain === zone.name,
      destinations = await pages(
        cf,
        `/accounts/${accountId}/email/routing/addresses`,
      );
    if (!apexOnly)
      throw new Error(
        "Automatic forwarding setup supports the zone apex only; subdomain routing requires separate Cloudflare onboarding",
      );
    let destination = destinations.find(
      (d) => d.email.toLowerCase() === forwardTo.toLowerCase(),
    );
    if (!destination)
      destination = await cf(
        `/accounts/${accountId}/email/routing/addresses`,
        "POST",
        { email: forwardTo },
      );
    if (!destination.verified) {
      status.forwarding = "pending_destination_verification";
      return status;
    }
    const dns = await cf(
      `/zones/${zone.id}/dns_records?name=${encodeURIComponent(forwarding.domain)}&per_page=100`,
    );
    if (
      dns.some(
        (r) =>
          (r.type === "MX" && !/\.mx\.cloudflare\.net\.?$/i.test(r.content)) ||
          (r.type === "TXT" &&
            normalized(r.content).startsWith("v=spf1") &&
            !r.content.includes("_spf.mx.cloudflare.net")),
      )
    )
      throw new Error(
        "Forwarding DNS conflict; do not replace existing MX/SPF",
      );
    let routing = await cf(`/zones/${zone.id}/email/routing`);
    if (!routing.enabled || routing.status !== "ready") {
      await cf(`/zones/${zone.id}/email/routing/dns`, "POST", {
        name: forwarding.domain,
      });
      routing = await cf(`/zones/${zone.id}/email/routing`);
    }
    if (!routing.enabled || routing.status !== "ready") {
      status.forwarding = "pending_dns_verification";
      return status;
    }
    const rules = await pages(cf, `/zones/${zone.id}/email/routing/rules`);
    for (const alias of forwarding.aliases) {
      const address = `${alias}@${forwarding.domain}`,
        name = `${slug}:${environment}:${address}`;
      const existing = rules.find((r) =>
        r.matchers?.some(
          (m) =>
            m.type === "literal" && m.field === "to" && m.value === address,
        ),
      );
      if (existing) {
        if (
          existing.name !== name ||
          !existing.enabled ||
          existing.actions.length !== 1 ||
          existing.actions[0].type !== "forward" ||
          existing.actions[0].value.length !== 1 ||
          existing.actions[0].value[0].toLowerCase() !== forwardTo.toLowerCase()
        )
          throw new Error(
            "Forwarding rule conflict; preserve existing destination",
          );
        continue;
      }
      await cf(`/zones/${zone.id}/email/routing/rules`, "POST", {
        name,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: address }],
        actions: [{ type: "forward", value: [forwardTo] }],
      });
    }
    status.forwarding = "configured";
  }
  return status;
}
