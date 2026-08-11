import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || 'postgres://aione:password@localhost:5432/aione',
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
