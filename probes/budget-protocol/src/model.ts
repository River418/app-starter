import { createWorkersAI } from 'workers-ai-provider';
import { normalizedBinding } from './workers-ai-stream.ts';
export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const modelFor = (binding: Ai) => createWorkersAI({ binding: normalizedBinding(binding) })(MODEL);
