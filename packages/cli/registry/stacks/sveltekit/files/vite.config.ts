import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			adapter: adapter(),
			paths: {
				origin: process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT_WEB ?? 3000}`
			}
		}),
		svelteTesting({ resolveBrowser: false })
	],
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
					exclude: ['src/lib/components/**', 'tests/db/**']
				}
			},
			{
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'components',
					environment: 'jsdom',
					include: ['src/lib/components/**/*.test.ts']
				}
			}
		],
		setupFiles: ['./tests/setup.ts'],
		coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts'] }
	}
});
