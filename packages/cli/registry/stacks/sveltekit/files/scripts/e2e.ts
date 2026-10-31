import { spawnSync } from 'node:child_process';

function run(command: string, args: string[], env = process.env) {
	const result = spawnSync(command, args, { stdio: 'inherit', env });
	if (result.error) throw result.error;
	return result.status ?? 1;
}

let code: number;
try {
	const built = run('bun', ['run', 'build'], {
		...process.env,
		APP_ORIGIN: `http://127.0.0.1:${process.env.PORT_E2E ?? 3100}`
	});
	code =
		built === 0 ? run('node_modules/.bin/playwright', ['test', ...process.argv.slice(2)]) : built;
} finally {
	// The separate verify probe uses PORT_WEB, even after a failed browser test.
	const restored = run('bun', ['run', 'build']);
	if (restored !== 0) code = restored;
}
process.exitCode = code;
