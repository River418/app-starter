import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const state = () =>
  JSON.parse(readFileSync(".local/e2e-users.json", "utf8")) as {
    admin: { email: string; password: string };
    member: { email: string; password: string };
  };
test("bootstrap, login, deep link, language, theme, mobile navigation and logout", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(state().admin.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(state().admin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/records/);
  await page.goto("/app/admin/users");
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle theme" }).click();
  const theme = await page.locator("html").getAttribute("data-theme");
  await page.reload();
  expect(await page.locator("html").getAttribute("data-theme")).toBe(theme);
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(
    page.getByRole("heading", { name: "用户", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "切换语言" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/app/admin/users");
  await expect(page).toHaveURL(/\/login/);
});
test("admin issues invite and member finishes real Supabase password setup", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(state().admin.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(state().admin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/records/);
  await page.goto("/app/admin/users");
  await page
    .getByLabel("Invite email")
    .fill(`starter-e2e-invite-${Date.now()}@example.test`);
  await page.getByLabel("Reason").fill("Browser acceptance");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("One-time link").inputValue();
  const context = await browser.newContext();
  const invited = await context.newPage();
  await invited.goto(link);
  await invited.getByRole("button", { name: "Confirm link" }).click();
  await expect(invited.getByLabel("New password")).toBeVisible();
  await invited.reload();
  await expect(invited.getByLabel("New password")).toBeVisible();
  await invited.getByLabel("New password").fill("Browser-New-Password-829!");
  await invited.getByRole("button", { name: "Set password" }).click();
  await expect(invited).toHaveURL(/\/app\/records/);
  await invited.goto("/app/admin/users");
  await expect(
    invited.getByText("Application access denied", { exact: false }),
  ).toBeVisible();
  await context.close();
});
