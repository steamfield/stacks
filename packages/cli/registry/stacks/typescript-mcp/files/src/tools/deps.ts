import type { AppConfig } from "../config.ts";
import type { Logger } from "../logging.ts";

/** What every tool module's register function receives. Add a dependency here, not a global. */
export type ToolDeps = {
  config: AppConfig;
  logger: Logger;
};
