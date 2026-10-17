import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("create/update/filter/reload/upload/download/delete with real API; account switch clears records", async ({
  page,
}) => {
  const users = JSON.parse(readFileSync(".local/e2e-users.json", "utf8"));
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(users.admin.email);
  await page.getByLabel("Password", { exact: true }).fill(users.admin.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Browser acceptance record");
  await page
    .getByLabel("Content", { exact: true })
    .fill("Persisted in actual local D1");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Browser acceptance record",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Content", { exact: true })
    .fill("Updated through the real API");
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/records/") &&
        response.status() === 200,
    ),
    page.getByRole("button", { name: "Save record" }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel("Content", { exact: true })).toHaveValue(
    "Updated through the real API",
  );
  await page.getByLabel("Upload attachment").setInputFiles({
    name: "private-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Private browser attachment"),
  });
  await expect(
    page.getByRole("link", { name: "private-note.txt" }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "private-note.txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("private-note.txt");
  await page.getByLabel("Search records").fill("acceptance");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=acceptance/);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Browser acceptance record",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New record", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Delete acceptance record");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Delete acceptance record",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Upload attachment")
    .setInputFiles({
      name: "delete-me.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("delete this attachment"),
    });
  await expect(page.getByRole("link", { name: "delete-me.txt" })).toBeVisible();
  await page
    .getByRole("button", { name: "Delete record", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete record", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Delete acceptance record",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(users.member.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(users.member.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Browser acceptance record", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("No records yet")).toBeVisible();
});
