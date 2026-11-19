import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.cwd(), 'skills/assesscraft-form-builder/scripts');
fs.mkdirSync(outDir, { recursive: true });

const banner = {
  js: `import { createRequire as __assesscraftCreateRequire } from 'node:module';
const require = __assesscraftCreateRequire(import.meta.url);`,
};

const entries = [
  {
    in: 'src/mcp/stdio.ts',
    out: path.join(outDir, 'assesscraft-mcp.mjs'),
  },
  {
    in: 'src/cli/publishGoogleFormCli.ts',
    out: path.join(outDir, 'publish-google-form.mjs'),
  },
  {
    in: 'src/cli/extractMaterialCli.ts',
    out: path.join(outDir, 'extract-material.mjs'),
  },
  {
    in: 'src/cli/generateAppsScriptCli.ts',
    out: path.join(outDir, 'generate-apps-script.mjs'),
  },
];

for (const entry of entries) {
  await build({
    entryPoints: [entry.in],
    outfile: entry.out,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: true,
    banner,
    logLevel: 'info',
  });
}

console.log('Built standalone zero-dependency skill scripts in', outDir);
