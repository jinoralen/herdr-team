import { defineConfig } from 'drizzle-kit';

// For `bun run db:generate`: regenerates the single migration from src/store/tables.ts.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/store/tables.ts',
  out: './drizzle',
});
