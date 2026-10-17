export type PlanKey = "monthly" | "creditPack";
export interface CatalogPlan {
  key: PlanKey;
  amountMinor: number;
  credits: number;
  features: string[];
}
export interface Catalog {
  enabled: boolean;
  ready: boolean;
  currency: string;
  taxBehavior: string;
  automaticTax: boolean;
  plans: CatalogPlan[];
}
export interface Entitlements {
  credits: number;
  free: number;
  subscription: number;
  purchased: number;
  features: string[];
  sources: {
    sourceKey: string;
    kind: string;
    remaining: number;
    validUntil: number | null;
    state: string;
    reviewReason: string | null;
  }[];
}
