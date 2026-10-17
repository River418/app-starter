import { createWorkersAI } from 'workers-ai-provider';
export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as const;
export const modelFor = (binding: Ai) => createWorkersAI({ binding })(MODEL);
