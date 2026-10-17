import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
let key: string;
test.beforeEach(async ({ page, baseURL }) => {
  key = JSON.parse(await readFile(resolve(root, '.local/probes/dev/secrets.json'), 'utf8')).PROBE_KEY;
  const cookie = JSON.parse(await readFile(resolve(root, '.local/probes/dev/session.json'), 'utf8')).cookie as string;
  if (baseURL!.startsWith('https:')) await page.context().addCookies(cookie.split('; ').map(entry => ({ name: entry.slice(0, entry.indexOf('=')), value: entry.slice(entry.indexOf('=') + 1), url: baseURL!, httpOnly: true, secure: true })));
  await page.goto('/');
  await page.getByLabel('Probe key').fill(key);
});
async function api(page: Page, path: string) {
  const response = await page.request.get('/api/probe/model' + path, { headers: { 'x-probe-key': key } });
  expect(response.status()).toBe(200);
  return response.json();
}
async function newThread(page: Page, scenario: string) {
  await page.getByLabel('Scenario').selectOption(scenario);
  await page.getByRole('button', { name: 'New probe' }).click();
  await expect(page).toHaveURL(/thread=/);
  const id = new URL(page.url()).searchParams.get('thread')!;
  test.info().annotations.push({ type: 'cloud-thread', description: id });
  await expect(page.getByLabel('Message')).toBeVisible();
  return id;
}
async function send(page: Page, text: string) {
  await page.getByLabel('Message').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('streams text and reloads persisted parts without a new model call', async ({ page }) => {
  const id = await newThread(page, 'text');
  await send(page, 'Give two short sentences about stars.');
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('done');
  const before = (await api(page, `/threads/${id}`)).thread;
  expect((await api(page, `/threads/${id}`)).runs[0].text_deltas).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-role="assistant"] .message-content p > span[data-status]')).toContainText(/\S/);
  await page.reload();
  await expect(page.locator('[data-role="assistant"] .message-content p > span[data-status]')).toContainText(/\S/);
  const after = (await api(page, `/threads/${id}`)).thread;
  expect(after.messages).toEqual(before.messages); expect(after.model_calls).toBe(before.model_calls);
});
test('renders a real read tool result and its continued model response', async ({ page }) => {
  const id = await newThread(page, 'read');
  await send(page, 'Read the current setting using readSetting.');
  await expect(page.getByTestId('read-result')).toContainText('initial');
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('done');
  expect((await api(page, `/threads/${id}`)).thread.model_calls).toBe(2);
});
test('asks for approval and commits the approved write exactly once', async ({ page }) => {
  const id = await newThread(page, 'write');
  await send(page, 'Use writeSetting to change the setting to approved-value.');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('awaiting_approval');
  expect((await api(page, `/threads/${id}`)).thread.writes).toBe(0);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('write-result')).toContainText('approved-value');
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('done');
  expect((await api(page, `/threads/${id}`)).thread.writes).toBe(1);
  await page.reload(); await expect(page.getByTestId('write-result')).toContainText('approved-value');
  expect((await api(page, `/threads/${id}`)).thread.writes).toBe(1);
});
test('denies a proposed write without executing it', async ({ page }) => {
  const id = await newThread(page, 'write');
  await send(page, 'Use writeSetting to change the setting to rejected-value.');
  await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('awaiting_approval');
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByTestId('write-denied')).toBeVisible();
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('done');
  const thread = (await api(page, `/threads/${id}`)).thread;
  expect(thread.writes).toBe(0); expect(thread.value).toBe('initial');
});
test('aborts the browser/Worker/provider signals and never reopens a cancelled run', async ({ page }) => {
  const id = await newThread(page, 'cancel');
  await send(page, 'Write a long list of 200 facts about astronomy.');
  await expect(page.locator('[data-role="assistant"] .message-content p > span[data-status]')).toContainText(/\S/);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(async () => (await api(page, `/threads/${id}`)).thread.state).toBe('cancelled');
  await expect.poll(async () => (await api(page, `/threads/${id}`)).runs.at(-1)?.request_aborted).toBe(1);
  await expect.poll(async () => (await api(page, `/threads/${id}`)).runs.at(-1)?.provider_aborted).toBe(1);
  const before = (await api(page, `/threads/${id}`)).thread;
  await page.reload();
  const after = (await api(page, `/threads/${id}`)).thread;
  expect(after.state).toBe('cancelled'); expect(after.model_calls).toBe(before.model_calls); expect(after.writes).toBe(0);
});
