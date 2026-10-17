import { readFile } from 'node:fs/promises';

export async function loadBrowserReport(file, expected) {
  let report;
  try { report = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (['runId','sourceCommit','model'].some(key => report.metadata?.[key] !== expected[key])) throw Error('Browser evidence belongs to a different run, source or model');
  return report;
}
