import { mkdir, readFile } from "node:fs/promises";
import { Schema } from "effect";
import { PackageInfo } from "../src/schemas/package";

const metadata = Schema.decodeUnknownSync(PackageInfo)(
  JSON.parse(await readFile("package.json", "utf8")),
);

await mkdir("dist", { recursive: true });
const child = Bun.spawn(
  [
    process.execPath,
    "build",
    "src/bin.ts",
    "--compile",
    "--minify",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--env=disable",
    "--define=COMPILED=true",
    "--outfile",
    `dist/${metadata.name}`,
  ],
  { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exitCode = await child.exited;
