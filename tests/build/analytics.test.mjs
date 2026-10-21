import { test } from "node:test";
import assert from "node:assert/strict";

let instance = 0;
async function browser(t) {
  const scripts = [];
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = { location: { origin: "https://app.example" } };
  globalThis.document = {
    referrer: "https://source.example/start?token=private#secret",
    createElement: () => ({}),
    head: { appendChild: (script) => scripts.push(script) },
  };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const { trackPageView } = await import(
    `../../src/client/lib/analytics.ts?test=${++instance}`
  );
  return { trackPageView, scripts };
}

const config = {
  environment: "prod",
  title: "Example App",
  analytics: { googleAnalyticsId: "G-TEST123456" },
};

test("analytics stays inactive without a valid ID or outside production", async (t) => {
  const { trackPageView, scripts } = await browser(t);
  for (const candidate of [
    { ...config, analytics: undefined },
    { ...config, analytics: { googleAnalyticsId: "" } },
    { ...config, analytics: { googleAnalyticsId: "bad-id" } },
    ...["local", "test", "e2e", "dev"].map((environment) => ({
      ...config,
      environment,
    })),
  ])
    trackPageView(candidate, "/");
  assert.equal(scripts.length, 0);
  assert.equal(window.dataLayer, undefined);
});

test("GA loads once and records initial, next and back visits without duplicate renders", async (t) => {
  const { trackPageView, scripts } = await browser(t);
  trackPageView(config, "/");
  trackPageView({ ...config }, "/");
  trackPageView(config, "/app/records");
  trackPageView(config, "/");
  assert.equal(scripts.length, 1);
  assert.equal(
    scripts[0].src,
    "https://www.googletagmanager.com/gtag/js?id=G-TEST123456",
  );
  assert.equal(scripts[0].async, true);
  const commands = window.dataLayer.map((args) => Array.from(args));
  const initialization = commands.filter(([command]) => command === "config");
  assert.equal(initialization.length, 1);
  assert.equal(initialization[0][2].send_page_view, false);
  assert.deepEqual(
    commands
      .filter(([command, name]) => command === "event" && name === "page_view")
      .map(([, , parameters]) => [
        parameters.page_location,
        parameters.page_referrer,
      ]),
    [
      ["https://app.example/", "https://source.example/start"],
      ["https://app.example/app/records", "https://app.example/"],
      ["https://app.example/", "https://app.example/app/records"],
    ],
  );
});

test("authentication credentials never enter the GA command queue", async (t) => {
  const { trackPageView } = await browser(t);
  trackPageView(
    config,
    "/auth/confirm?token_hash=private&type=recovery#access_token=secret",
  );
  const commands = window.dataLayer.map((args) => Array.from(args));
  const pageView = commands.find(([command]) => command === "event")[2];
  assert.equal(pageView.page_location, "https://app.example/auth/confirm");
  assert.equal(pageView.page_title, "Example App");
  const serialized = JSON.stringify(commands);
  assert.doesNotMatch(serialized, /private|secret|token_hash|access_token/);
  // Defaults must be sanitized before config can trigger automatic GA events.
  assert.equal(commands[0][0], "set");
  assert.equal(
    commands[0][1].page_location,
    "https://app.example/auth/confirm",
  );
});
