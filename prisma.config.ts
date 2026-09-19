import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // `prisma db seed` has no seed command without this — the seed creates the
    // app_config row, games and the admin user that the API expects to exist.
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
});
