import { integer, pgTable, text } from 'drizzle-orm/pg-core';

export const items = pgTable('items', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
});
