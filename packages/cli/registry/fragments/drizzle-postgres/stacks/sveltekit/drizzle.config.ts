// drizzle-kit runs on Node outside SvelteKit's env loading, so it reads .env.local and .env here.
// Variables already set win over the files, but a DATABASE_URL in a file would still beat the
// PORT_DB verify passes, so .env.example leaves it commented out and the URL comes from PORT_DB.
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

for (const file of ['.env.local', '.env']) if (existsSync(file)) process.loadEnvFile(file);

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/db/schema.ts',
	// db:check generates into a temporary copy through DRIZZLE_OUT; everything else uses drizzle/.
	out: process.env.DRIZZLE_OUT ?? './drizzle',
	strict: true,
	verbose: true,
	dbCredentials: {
		url:
			process.env.DATABASE_URL ||
			`postgres://app:app@localhost:${process.env.PORT_DB || '5432'}/app`
	}
});
