/**
 * Fixes SyntaxError when project path contains a double quote (e.g. folder "AgentForge").
 * The bundler embeds the path in JS; an unescaped " breaks the string. This replaces
 * "AgentForge" with \"AgentForge\" in built client JS so the literal is valid.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const clientDist = join(process.cwd(), 'dist', 'apps', 'client');

function fixDir(dir) {
  let changed = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name);
    if (name.isDirectory()) {
      changed += fixDir(full);
    } else if (name.name.endsWith('.js')) {
      let content = readFileSync(full, 'utf8');
      const before = content;
      content = content.replace(/"AgentForge"/g, '\\"AgentForge\\"');
      if (content !== before) {
        writeFileSync(full, content);
        changed += 1;
      }
    }
  }
  return changed;
}

try {
  const count = fixDir(clientDist);
  if (count > 0) {
    console.log(`fix-path-in-build: escaped path in ${count} file(s) under dist/apps/client`);
  }
} catch (e) {
  if (e.code === 'ENOENT') {
    console.warn('fix-path-in-build: dist/apps/client not found (run client build first)');
  } else {
    throw e;
  }
}
