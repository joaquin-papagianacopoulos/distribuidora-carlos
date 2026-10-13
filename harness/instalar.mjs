#!/usr/bin/env node
// Instala la configuración del harness que no se puede copiar remotamente:
//   - harness/claude-config/{agents,commands,settings.json}  →  .claude/
//   - harness/claude-config/env.production                   →  .env.production
// Uso (una sola vez, desde la carpeta del proyecto):  node harness/instalar.mjs
import { cpSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'harness', 'claude-config');
mkdirSync(join(ROOT, '.claude'), { recursive: true });
cpSync(join(SRC, 'agents'), join(ROOT, '.claude', 'agents'), { recursive: true });
cpSync(join(SRC, 'commands'), join(ROOT, '.claude', 'commands'), { recursive: true });
const settings = join(ROOT, '.claude', 'settings.json');
if (existsSync(settings)) console.log('· .claude/settings.json ya existe: no se pisa (compará con harness/claude-config/settings.json)');
else copyFileSync(join(SRC, 'settings.json'), settings);
const envProd = join(ROOT, '.env.production');
if (existsSync(envProd)) console.log('· .env.production ya existe: no se pisa (compará con harness/claude-config/env.production)');
else copyFileSync(join(SRC, 'env.production'), envProd);
console.log('✓ Harness instalado: .claude/agents, .claude/commands, .claude/settings.json y .env.production');
