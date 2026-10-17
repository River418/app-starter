export type GateName = 'deployment' | 'budget-protocol' | 'recovery';
export type GateStatus = 'not_run' | 'pass' | 'fail' | 'blocked';

export interface GateCase {
  id: string;
  status: GateStatus | 'waived';
  expected: string;
  actual: string;
  cloudIds: string[];
}

export interface GateReport {
  schemaVersion: 1;
  gate: GateName;
  status: GateStatus;
  sourceCommit: string;
  cleanWorkingTree: boolean;
  lockfileSha256: string;
  versionsSha256: string;
  environment: string;
  platformPlan: 'free' | 'paid';
  mode: 'local' | 'cloud';
  executedAt: string;
  cases: GateCase[];
  evidence: { path: string; sha256: string; source: 'cloudflare' | 'stripe' | 'browser' | 'probe'; role?: string }[];
  blockers?: string[];
  stripeMode?: 'sandbox' | 'waived';
  stripeException?: 'stripe-sandbox-2026-10-17';
  paymentValidation?: 'unverified';
  stripeAccounts?: string[];
  model?: string;
  samplesPerBoundary?: number;
  metrics?: {
    name: string;
    limitMs: number;
    p95Ms: number;
    maxMs: number;
    sampleCounts: { typical: number; maximum: number; cold: number };
    outcomes: string[];
  }[];
}
