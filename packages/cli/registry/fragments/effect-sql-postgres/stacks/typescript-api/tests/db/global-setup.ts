// Runs once per test:db run, before any worker: migrates the run's template and hands its name
// to the test files. The returned function drops it when the run ends.
import type { TestProject } from "vitest/node";
import { adminHost, createMigrated, dropDatabase, newRunId, templateName } from "./databases.ts";

declare module "vitest" {
  export interface ProvidedContext {
    dbRun: string;
    dbTemplate: string;
  }
}

export default async function setup(project: TestProject) {
  const run = newRunId();
  const template = templateName(run);
  // Name the server, so a run against another project's Postgres is visible.
  console.info(`test:db uses db-test at ${adminHost()}`);
  try {
    await createMigrated(template);
  } catch (error) {
    // Vite's module runner can crash while Vitest prints a global-setup error's stack, which
    // hides the error itself, so print the message first.
    console.error(error instanceof Error ? error.message : error);
    throw error;
  }
  project.provide("dbRun", run);
  project.provide("dbTemplate", template);
  return async () => {
    await dropDatabase(template);
  };
}
