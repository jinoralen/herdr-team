// Compose owns deployment records independently of hub membership.
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const deploymentRecords = sqliteTable(
  'deployments',
  {
    room: text().notNull(),
    name: text().notNull(),
    record: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.room, t.name] })],
);
