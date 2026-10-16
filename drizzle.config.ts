import { defineConfig } from 'drizzle-kit';

// For `bun run db:generate`: compares src/store/tables.ts with the last migration and writes the next one.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/store/tables.ts',
  out: './drizzle',
});
