import { env } from '@/lib/runtime';
export function getDb() { if (!env.DB) throw new Error('Database is not configured'); return env.DB; }
