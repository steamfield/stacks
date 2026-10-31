import { asc } from 'drizzle-orm';
import { db } from '../db';
import { items } from '../db/schema';

export async function listItems(url: string, limit: number) {
  return { items: await db(url).db.select().from(items).orderBy(asc(items.id)).limit(limit) };
}
