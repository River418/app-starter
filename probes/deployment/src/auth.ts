import { betterAuth, type BetterAuthOptions } from 'better-auth';

export interface AuthEnvironment {
  DB: NonNullable<BetterAuthOptions['database']>;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

export function createAuthOptions(env: AuthEnvironment) {
  return {
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: { enabled: true },
  } satisfies BetterAuthOptions;
}

export function createAuth(env: AuthEnvironment) {
  return betterAuth(createAuthOptions(env));
}
