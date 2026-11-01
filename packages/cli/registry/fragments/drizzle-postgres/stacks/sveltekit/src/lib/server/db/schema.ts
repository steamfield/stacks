// Drizzle tables. drizzle-kit loads this file under plain Node: no #lib or $app imports and no
// imports from app code.
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const items = pgTable('items', {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
	name: text().notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
