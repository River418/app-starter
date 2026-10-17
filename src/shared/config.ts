export interface AppConfig {
  slug: string;
  title: string;
  preset: "web" | "agent";
  authMode: "invite" | "public";
  maxFileBytes: number;
}
export interface PublicConfig extends AppConfig {
  environment: string;
  authReady: boolean;
  supabaseUrl: string;
  supabasePublishableKey: string;
}
