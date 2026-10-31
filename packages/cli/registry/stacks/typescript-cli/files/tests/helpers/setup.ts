import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Both runners load this before application modules, including when Bun loaded .env.
for (const key of Object.keys(process.env)) {
  if (
    /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|ACCESS_KEY|AUTH|_URL$|LOG_|_DATA_DIR$|_GREETING$/.test(
      key,
    )
  )
    delete process.env[key];
}
const home = mkdtempSync(join(tmpdir(), "cli-isolation-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, "config");
process.env.XDG_DATA_HOME = join(home, "data");
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
