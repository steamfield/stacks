/**
 * Defines the configuration and logger supplied to each tool's registration function. The
 * server passes these dependencies explicitly rather than tools reading global state.
 */

import type { AppConfig } from "../config.ts";
import type { Logger } from "../logging.ts";

/** What every tool module's register function receives. Add a dependency here, not a global. */
export type ToolDeps = {
  config: AppConfig;
  logger: Logger;
};
