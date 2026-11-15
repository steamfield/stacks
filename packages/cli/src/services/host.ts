/**
 * Facts about the machine and the running package that only the process entry point can know:
 * the Node version, the working directory, whether each standard stream is a terminal and how
 * wide it is, and where the bundled registry, skills and authoring guide were installed.
 *
 * `bin.ts` reads them from Node once and provides `Host.layer`; tests use `Host.memory`. Core
 * code reads `Host` instead of `process` or `import.meta.url`, so it runs the same from source,
 * from the packed bundle and under test, and a missing value is a type error rather than a
 * fallback computed somewhere it breaks in the bundle.
 */
import { Context, Layer, Option } from "effect";
export type HostInfo = {
  /** Node line, supplied by the platform boundary. */
  nodeMajor: number;
  platform: string;
  executable: string;
  cwd: string;
  /** Whether stdin and stdout are terminals; bin.ts reads them so core never touches the streams. */
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  /** The terminal's width when stdout is one; human layouts wrap to it. */
  columns: Option.Option<number>;
  /** Display width in terminal columns, escape sequences excluded. */
  stringWidth: (text: string) => number;
  /**
   * The bundled registry root, resolved by bin.ts; core code never computes it.
   */
  registry: string;
  /** The running package root, resolved by bin.ts. */
  packageRoot: string;
  /** The bundled skills root (one directory per skill), resolved by bin.ts beside the registry. */
  skill: string;
  /** The authoring guide, resolved by bin.ts beside the registry and skill. */
  authoring: string;
  /** How a person runs this CLI, for copy-paste `Next:` lines. */
  invocation: string;
};
export class Host extends Context.Service<Host, HostInfo>()("stacks/Host") {
  static layer = (value: HostInfo) => Layer.succeed(Host, value);
  static memory = (overrides: Partial<HostInfo> = {}) =>
    Host.layer({
      nodeMajor: 24,
      platform: "test",
      executable: "/test/cli",
      cwd: "/test",
      stdinIsTTY: false,
      stdoutIsTTY: false,
      stderrIsTTY: overrides.stdoutIsTTY ?? false,
      columns: Option.none(),
      stringWidth: (text) => Array.from(text).length,
      registry: "/test/registry",
      packageRoot: "/test/package",
      skill: "/test/skill",
      authoring: "/test/docs/authoring.md",
      invocation: "stacks",
      ...overrides,
    });
}
