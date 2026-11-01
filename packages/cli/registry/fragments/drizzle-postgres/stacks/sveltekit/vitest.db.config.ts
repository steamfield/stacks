// test:db: one Node project that extends the base config (SvelteKit's Vite plugins and aliases)
// but replaces its projects, so tests/db/ runs alone and no browser resolution reaches it.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globalSetup: ['./tests/db/global-setup.ts'],
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'db',
					environment: 'node',
					include: ['tests/db/**/*.test.ts'],
					exclude: [],
					// The first file waits for the template.
					hookTimeout: 30_000,
					testTimeout: 30_000
				}
			}
		]
	}
});
