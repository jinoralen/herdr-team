import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/store/tables.ts',
  out: './drizzle',
});
