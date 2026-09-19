import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');
const cli = new URL('../node_modules/next/dist/bin/next', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), 'dev', '--port', '5173'];
await import(cli.href);
