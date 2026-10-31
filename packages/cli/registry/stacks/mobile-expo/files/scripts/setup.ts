import { copyFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
if (!existsSync(join(root, '.env'))) copyFileSync(join(root, '.env.example'), join(root, '.env'));
const mobileEnv = join(root, 'apps/mobile/.env');
if (!existsSync(mobileEnv)) symlinkSync('../../.env', mobileEnv);
