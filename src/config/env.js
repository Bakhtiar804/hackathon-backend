import 'dotenv/config';
import { z } from 'zod';
import { GEMINI_BASE_URL, resolveAIConfig } from '../services/ai-provider.js';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  MONGODB_URI: z.string().min(1).regex(/^mongodb(?:\+srv)?:\/\//,'MONGODB_URI must use mongodb:// or mongodb+srv://'),
  JWT_SECRET: z.string().min(32),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.url().default(GEMINI_BASE_URL),
  AI_MODEL: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(['trace','debug','info','warn','error','fatal','silent']).default('info'),
});
const parsed = schema.parse(process.env);
export const env = { ...parsed, ...resolveAIConfig(parsed) };
