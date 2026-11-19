import fs from 'node:fs';
import path from 'node:path';
import { parseUploadedBuffer } from '../server/materialParser.ts';

async function main() {
  const filePaths = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (filePaths.length === 0) {
    console.error('Penggunaan: node extract-material.mjs <file1.docx|pptx|txt|...> [...]');
    process.exit(1);
  }

  process.env.ASSESSCRAFT_STDIO_MODE = '1';

  const results = [];
  for (const rawPath of filePaths) {
    const resolved = path.resolve(rawPath);
    if (!fs.existsSync(resolved)) {
      results.push({
        path: rawPath,
        error: 'File tidak ditemukan.',
      });
      continue;
    }

    const buffer = fs.readFileSync(resolved);
    const parsed = await parseUploadedBuffer({
      filename: path.basename(resolved),
      buffer,
    });

    results.push({
      id: parsed.id,
      name: parsed.name,
      kind: parsed.kind,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      slideOrPageCount: parsed.slideOrPageCount,
      embeddedMediaCount: parsed.embeddedMediaCount || 0,
      readabilityStatus: parsed.readabilityStatus,
      readabilityMessage: parsed.readabilityMessage,
      extractedText: parsed.extractedText,
    });
  }

  console.log(JSON.stringify({ files: results }, null, 2));
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        error: err instanceof Error ? err.message : 'Gagal mengekstrak materi.',
      },
      null,
      2
    )
  );
  process.exit(1);
});
