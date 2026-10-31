import { HTTPException } from 'hono/http-exception';
import { db } from '../db';

export async function readiness(url: string) {
  try {
    await db(url).sql`select 1`;
  } catch (cause) {
    throw new HTTPException(503, { message: 'Database unavailable', cause });
  }
  return { status: 'ready' as const };
}
