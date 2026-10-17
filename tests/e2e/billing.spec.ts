import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test.skip(
  !process.env.APP_STARTER_BILLING_E2E,
  "Dedicated isolated payment provider suite",
);
test("purchase through real API, signed provider callback, persisted entitlement and refund; member cannot administer", async ({
  page,
}) => {
  const users = JSON.parse(readFileSync(".local/e2e-users.json", "utf8"));
  await page.goto("/pricing");
  await expect(
    page.getByRole("heading", { name: "Credit pack" }),
  ).toBeVisible();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(users.member.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(users.member.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/app\/records/);
  await page.getByRole("link", { name: "Billing", exact: true }).click();
  await page.getByRole("link", { name: "Plans and pricing" }).click();
  const lost = await page.evaluate(async () => {
    const identity = await fetch("/api/session").then((r) => r.json()),
      operationId = crypto.randomUUID();
    const order = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey: "creditPack", operationId }),
    }).then((r) => r.json());
    sessionStorage.setItem(
      `checkout:${identity.userId}:creditPack`,
      operationId,
    );
    return { session: new URL(order.url).searchParams.get("session")! };
  });
  await fetch("http://localhost:55431/expire", {
    method: "POST",
    body: new URLSearchParams(lost),
  });
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Checkout expired; start a new operation",
  );
  await page.getByRole("button", { name: "Continue to checkout" }).click();
  await expect(
    page.getByRole("heading", { name: "Local payment simulator" }),
  ).toBeVisible();
  const session = new URL(page.url()).searchParams.get("session")!;
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Payment confirmed. Your entitlements are available.",
  );
  await page.getByRole("link", { name: "Billing", exact: true }).last().click();
  await expect(
    page.getByText("Available: 50 credits", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Available features: export")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Available: 50 credits", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/billing-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/billing-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const refund = await fetch("http://localhost:55431/refund", {
    method: "POST",
    body: new URLSearchParams({ session }),
  });
  expect(refund.ok).toBe(true);
  await page.reload();
  await expect(
    page.getByText("Available: 0 credits", { exact: true }),
  ).toBeVisible();
  await page.goto("/app/admin/billing");
  await expect(
    page.getByText("Application access denied", { exact: true }),
  ).toBeVisible();
});
