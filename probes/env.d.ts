import type { ProbeEnvironment } from './deployment/src/index.ts';
import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./deployment/src/index.ts');
    }
    interface Env extends ProbeEnvironment {
      TEST_MIGRATIONS: D1Migration[];
      STRIPE_WEBHOOK_SECRET: string;
    }
  }
}
