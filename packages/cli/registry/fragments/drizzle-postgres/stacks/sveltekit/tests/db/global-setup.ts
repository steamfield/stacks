// Runs once per test:db run, before any worker: migrates the run's template and hands its name
// to the test files. The returned function drops it when the run ends.
import type { TestProject } from 'vitest/node';
import { createMigrated, dropDatabase, newRunId, templateName } from './databases';

declare module 'vitest' {
	export interface ProvidedContext {
		dbRun: string;
		dbTemplate: string;
	}
}

export default async function setup(project: TestProject) {
	const run = newRunId();
	const template = templateName(run);
	await createMigrated(template);
	project.provide('dbRun', run);
	project.provide('dbTemplate', template);
	return async () => {
		await dropDatabase(template);
	};
}
