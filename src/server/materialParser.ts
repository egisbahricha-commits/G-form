import crypto from 'node:crypto';
import path from 'node:path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { EmbeddedMediaItem, MaterialFile, MaterialKind } from '../shared/types.ts';
import { saveMaterialBlob } from './store.ts';

const IMAGE_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.pdf',
  '.docx',
  '.pptx',
  '.txt',
  '.md',
  '.csv',
]);

export function detectMaterialKind(filename: string, mimeType: string): MaterialKind | null {
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase();

  if (IMAGE_MIME_MAP[ext] || mime.startsWith('image/')) {
    if (
      mime.includes('jpeg') ||
      mime.includes('jpg') ||
      mime.includes('png') ||
      mime.includes('webp') ||
      ext in IMAGE_MIME_MAP
    ) {
      return 'image';
    }
  }
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (
    ext === '.docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (
    ext === '.pptx' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'pptx';
  }
  if (ext === '.txt' || ext === '.md' || ext === '.csv' || mime.startsWith('text/')) {
    return 'txt';
  }
  return null;
}

export function normalizeMimeType(filename: string, mimeType?: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_MIME_MAP[ext]) return IMAGE_MIME_MAP[ext];
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (ext === '.pptx') {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (ext === '.txt' || ext === '.md' || ext === '.csv') return 'text/plain';
  return mimeType || 'application/octet-stream';
}

function collectStringsRecursively(node: unknown, out: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectStringsRecursively(item, out);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith('@_')) continue;
      collectStringsRecursively(value, out);
    }
  }
}

async function extractMediaFromZip(
  zip: JSZip,
  prefix: string,
  maxImages = 8
): Promise<EmbeddedMediaItem[]> {
  const items: EmbeddedMediaItem[] = [];
  const entries = Object.keys(zip.files).filter((name) => {
    const lower = name.toLowerCase();
    return (
      lower.startsWith(prefix) &&
      (lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp'))
    );
  });

  for (const entryName of entries.slice(0, maxImages)) {
    const file = zip.file(entryName);
    if (!file) continue;
    const buf = await file.async('nodebuffer');
    if (buf.length < 256 || buf.length > 6 * 1024 * 1024) continue;
    const ext = path.extname(entryName).toLowerCase();
    items.push({
      id: `media_${crypto.randomUUID().slice(0, 6)}`,
      name: path.basename(entryName),
      mimeType: IMAGE_MIME_MAP[ext] || 'image/png',
      base64Data: buf.toString('base64'),
    });
  }
  return items;
}

async function parseDocxBuffer(buffer: Buffer): Promise<{
  text: string;
  embeddedMedia: EmbeddedMediaItem[];
}> {
  const rawResult = await mammoth.extractRawText({ buffer });
  const htmlResult = await mammoth.convertToHtml({ buffer });

  // Preserve readable table structure alongside raw text
  const cleanedHtmlText = htmlResult.value
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>|<\/th>/gi, ' | ')
    .replace(/<\/p>|<\/h[1-6]>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const text = cleanedHtmlText.length >= rawResult.value.trim().length
    ? cleanedHtmlText
    : rawResult.value.trim();

  let embeddedMedia: EmbeddedMediaItem[] = [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    embeddedMedia = await extractMediaFromZip(zip, 'word/media/');
  } catch {
    embeddedMedia = [];
  }

  return { text, embeddedMedia };
}

async function parsePptxBuffer(buffer: Buffer): Promise<{
  text: string;
  slideCount: number;
  embeddedMedia: EmbeddedMediaItem[];
}> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
      return numA - numB;
    });

  const slideTexts: string[] = [];

  for (const slidePath of slideFiles) {
    const slideNum = slidePath.match(/slide(\d+)\.xml/i)?.[1] || '?';
    const xmlStr = await zip.file(slidePath)?.async('string');
    if (!xmlStr) continue;

    const parsed = parser.parse(xmlStr);
    const lines: string[] = [];
    collectStringsRecursively(parsed, lines);

    // Check speaker notes for this slide if present
    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notesLines: string[] = [];
    if (zip.file(notesPath)) {
      const notesXml = await zip.file(notesPath)?.async('string');
      if (notesXml) {
        const parsedNotes = parser.parse(notesXml);
        collectStringsRecursively(parsedNotes, notesLines);
      }
    }

    const combinedSlide = [
      `=== Slide ${slideNum} ===`,
      lines.join(' '),
      notesLines.length > 0 ? `[Catatan Presenter Slide ${slideNum}]: ${notesLines.join(' ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    slideTexts.push(combinedSlide);
  }

  const embeddedMedia = await extractMediaFromZip(zip, 'ppt/media/');

  return {
    text: slideTexts.join('\n\n'),
    slideCount: slideFiles.length,
    embeddedMedia,
  };
}

export async function parseUploadedBuffer(params: {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<MaterialFile> {
  const { filename, buffer } = params;
  const normalizedMime = normalizeMimeType(filename, params.mimeType);
  const kind = detectMaterialKind(filename, normalizedMime);

  if (!kind) {
    const ext = path.extname(filename).toLowerCase() || '(tanpa ekstensi)';
    throw new Error(
      `Format file "${filename}" (${ext}) tidak didukung. Format yang didukung: ${Array.from(SUPPORTED_EXTENSIONS).join(', ')}.`
    );
  }

  if (buffer.length === 0) {
    throw new Error(`File "${filename}" kosong (0 byte). Silakan unggah file materi yang valid.`);
  }

  const id = `mat_${crypto.randomUUID().slice(0, 8)}`;
  const uploadedAt = new Date().toISOString();

  if (kind === 'image') {
    const base64Data = buffer.toString('base64');
    const blobPath = saveMaterialBlob(id, normalizedMime, base64Data);
    const previewDataUrl =
      buffer.length <= 2 * 1024 * 1024
        ? `data:${normalizedMime};base64,${base64Data}`
        : undefined;

    return {
      id,
      name: filename,
      mimeType: normalizedMime,
      sizeBytes: buffer.length,
      kind: 'image',
      extractedText: '',
      blobPath,
      hasBinaryBlob: true,
      previewDataUrl,
      uploadedAt,
      readabilityStatus: 'pending',
    };
  }

  if (kind === 'pdf') {
    const base64Data = buffer.toString('base64');
    const blobPath = saveMaterialBlob(id, 'application/pdf', base64Data);
    // Rough page count heuristic from PDF /Type /Page markers
    const latinText = buffer.toString('latin1');
    const pageMatches = latinText.match(/\/Type\s*\/Page[^s]/g);
    const slideOrPageCount = pageMatches ? pageMatches.length : undefined;

    return {
      id,
      name: filename,
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
      kind: 'pdf',
      extractedText: '',
      blobPath,
      hasBinaryBlob: true,
      slideOrPageCount,
      uploadedAt,
      readabilityStatus: 'pending',
    };
  }

  if (kind === 'docx') {
    const { text, embeddedMedia } = await parseDocxBuffer(buffer);
    const blobPath =
      embeddedMedia.length > 0
        ? saveMaterialBlob(id, normalizedMime, '', embeddedMedia)
        : undefined;
    const isEmpty = text.trim().length < 10 && embeddedMedia.length === 0;

    return {
      id,
      name: filename,
      mimeType: normalizedMime,
      sizeBytes: buffer.length,
      kind: 'docx',
      extractedText: text,
      blobPath,
      hasBinaryBlob: embeddedMedia.length > 0,
      embeddedMediaCount: embeddedMedia.length,
      uploadedAt,
      readabilityStatus: isEmpty ? 'unreadable' : 'readable',
      readabilityMessage: isEmpty
        ? 'Dokumen DOCX tidak mengandung teks atau gambar yang dapat dibaca. Mohon periksa atau unggah ulang file.'
        : undefined,
    };
  }

  if (kind === 'pptx') {
    const { text, slideCount, embeddedMedia } = await parsePptxBuffer(buffer);
    const blobPath =
      embeddedMedia.length > 0
        ? saveMaterialBlob(id, normalizedMime, '', embeddedMedia)
        : undefined;
    const isEmpty = text.trim().length < 10 && embeddedMedia.length === 0;

    return {
      id,
      name: filename,
      mimeType: normalizedMime,
      sizeBytes: buffer.length,
      kind: 'pptx',
      extractedText: text,
      blobPath,
      hasBinaryBlob: embeddedMedia.length > 0,
      embeddedMediaCount: embeddedMedia.length,
      slideOrPageCount: slideCount,
      uploadedAt,
      readabilityStatus: isEmpty ? 'unreadable' : 'readable',
      readabilityMessage: isEmpty
        ? 'Presentasi PPTX tidak memiliki teks slide atau gambar yang terbaca. Mohon unggah ulang.'
        : undefined,
    };
  }

  // Plain text (.txt, .md, .csv)
  const text = buffer.toString('utf-8').trim();
  const isEmpty = text.length < 5;

  return {
    id,
    name: filename,
    mimeType: 'text/plain',
    sizeBytes: buffer.length,
    kind: 'txt',
    extractedText: text,
    uploadedAt,
    readabilityStatus: isEmpty ? 'unreadable' : 'readable',
    readabilityMessage: isEmpty
      ? 'File teks kosong atau terlalu pendek untuk dijadikan materi.'
      : undefined,
  };
}

export function createTypedTextMaterial(title: string, content: string): MaterialFile {
  const cleanContent = content.trim();
  if (cleanContent.length < 10) {
    throw new Error('Materi yang diketik terlalu singkat (minimal 10 karakter).');
  }
  const id = `mat_${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    name: title.trim() || `Materi Teks (${new Date().toLocaleTimeString('id-ID')})`,
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength(cleanContent, 'utf-8'),
    kind: 'text',
    extractedText: cleanContent,
    uploadedAt: new Date().toISOString(),
    readabilityStatus: 'readable',
  };
}
