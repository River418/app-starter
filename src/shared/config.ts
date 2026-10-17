export interface BillingPlan {
  amountMinor: number;
  credits: number;
  features?: string[];
}
export interface BillingConfig {
  enabled: boolean;
  currency: string;
  monthly?: BillingPlan;
  creditPack?: BillingPlan;
  freeCredits?: number;
  freeFeatures?: string[];
  taxBehavior?: "inclusive" | "exclusive";
  automaticTax?: boolean;
}
export interface AppConfig {
  email?: {
    sending?: { domain: string; from: string; replyTo?: string };
    forwarding?: { domain: string; aliases: string[] };
  };
  slug: string;
  title: string;
  preset: "web" | "agent";
  authMode: "invite" | "public";
  maxFileBytes: number;
  billing?: BillingConfig;
}
export interface PublicConfig extends AppConfig {
  billingEnabled: boolean;
  environment: string;
  authReady: boolean;
  supabaseUrl: string;
  supabasePublishableKey: string;
}
