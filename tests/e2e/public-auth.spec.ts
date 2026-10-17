import { test, expect } from "@playwright/test";
async function mailLink(email: string, type: "email" | "recovery") {
  let link = "";
  await expect
    .poll(
      async () => {
        const listing = await (
          await fetch("http://localhost:55324/api/v1/messages")
        ).json();
        for (const message of listing.messages || []) {
          if (
            !(message.To || []).some(
              (to: { Address: string }) => to.Address === email,
            )
          )
            continue;
          const detail = await (
            await fetch(`http://localhost:55324/api/v1/message/${message.ID}`)
          ).json();
          for (const value of (detail.HTML || detail.Text || "").matchAll(
            /https?:\/\/localhost:5173\/auth\/confirm\?[^"\s<>]+/g,
          )) {
            const candidate = value[0].replaceAll("&amp;", "&");
            if (new URL(candidate).searchParams.get("type") === type) {
              link = candidate;
              return true;
            }
          }
        }
        return false;
      },
      {
        timeout: 15000,
        message: "Real confirmation mail arrived in isolated Mailpit",
      },
    )
    .toBe(true);
  return link;
}
test("public signup requires real email confirmation; email recovery replaces password", async ({
  page,
}) => {
  const email = `starter-e2e-public-${Date.now()}@example.test`;
  const password = "Public-Initial-Password-345!";
  const replacement = "Public-Recovered-Password-987!";
  await page.goto("/sign-up");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Email not confirmed", { exact: false }),
  ).toBeVisible();
  const confirmation = await mailLink(email, "email");
  await page.goto(confirmation);
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(page).toHaveURL(/\/app\/records/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/reset-password");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  const recovery = await mailLink(email, "recovery");
  await page.goto(recovery);
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(page.getByLabel("New password")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("New password")).toBeVisible();
  await page.getByLabel("New password").fill(replacement);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/app\/records/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/records/);
  await page.goto(recovery);
  await page.getByRole("button", { name: "Confirm link" }).click();
  await expect(
    page.getByText("Link expired or already used", { exact: false }),
  ).toBeVisible();
});
