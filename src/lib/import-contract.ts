import { readKeepHtml, readKeepJson } from './keep-import.ts';

// UTF-8 only. Limits bound both review memory and server requests.
export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_BYTES = 256 * 1024;
export const MAX_BATCH_BYTES = 2 * 1024 * 1024;
export type ImportMetadata = { title?: string; created_at?: string; source_type?: string; source_name?: string; source_url?: string; source_context?: string; provider?: 'google_keep'; original_updated_at?: string };
export type ImportDraft = { filename: string; content: string; metadata: ImportMetadata; warnings: string[]; size: number };

export function decodeImport(bytes: Uint8Array, maxCharacters = 100_000): string {
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('This file is larger than 256 KB.');
  // Strict decoding also works on native engines without TextDecoder's fatal option.
  const characters: string[] = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let value: number; let count: number; let minimum: number;
    if (first < 0x80) { value = first; count = 0; minimum = 0; }
    else if (first >= 0xc2 && first <= 0xdf) { value = first & 31; count = 1; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { value = first & 15; count = 2; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { value = first & 7; count = 3; minimum = 0x10000; }
    else throw new Error('This file is not valid UTF-8 text.');
    for (let j = 0; j < count; j++) {
      const next = bytes[i++];
      if (next === undefined || (next & 0xc0) !== 0x80) throw new Error('This file is not valid UTF-8 text.');
      value = value * 64 + (next & 63);
    }
    if (value < minimum || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff) throw new Error('This file is not valid UTF-8 text.');
    if (value === 0 || value < 32 && ![9, 10, 13].includes(value) || value === 127) throw new Error('This file contains non-text data.');
    // A leading byte-order mark is an encoding marker, not note content.
    if (characters.length === 0 && i === 3 && value === 0xfeff) continue;
    characters.push(String.fromCodePoint(value));
    if (characters.length > maxCharacters) throw new Error('Keep each note under 100,000 characters.');
  }
  const content = characters.join('');
  if (!content.trim()) throw new Error('This file is empty.');
  return content;
}

export function readImport(filename: string, bytes: Uint8Array, now = Date.now()): ImportDraft {
  if (!/^.+\.(txt|md|json|html)$/i.test(filename)) throw new Error('Choose .txt, .md, or Google Keep .json or .html files.');
  if (!filename.trim() || Array.from(filename).length > 255 || /[\x00-\x1f/\\]/.test(filename)) throw new Error('This file name is not supported.');
  if (/\.(json|html)$/i.test(filename)) {
    const source = decodeImport(bytes, MAX_IMPORT_BYTES);
    const parsed = /\.json$/i.test(filename) ? readKeepJson(source, now) : readKeepHtml(source);
    let count = 0; let size = 0;
    for (const character of parsed.content) {
      const point = character.codePointAt(0)!;
      if (point === 0 || point < 32 && ![9, 10, 13].includes(point) || point === 127 || point >= 0xd800 && point <= 0xdfff) throw new Error('This note contains invalid text characters.');
      count++; size += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
    }
    if (count > 100_000 || size > MAX_IMPORT_BYTES) throw new Error('Keep each note under 256 KB and 100,000 characters.');
    if (Array.from(parsed.metadata.title ?? '').length > 300) throw new Error('This note title is longer than 300 characters.');
    return { filename, ...parsed, size: bytes.length };
  }
  const content = decodeImport(bytes);
  const metadata: ImportMetadata = {};
  const warnings: string[] = [];
  // A deliberately small, literal front-matter subset. No YAML execution,
  // date guesses, file-system dates, or removal of the original header.
  const header = content.match(/^---\r?\n([\s\S]{0,4096}?)\r?\n---(?:\r?\n|$)/);
  if (header) {
    const keys = new Set(['title', 'created_at', 'source_type', 'source_name', 'source_url', 'source_context']);
    const seen = new Set<string>();
    for (const line of header[1].split(/\r?\n/)) {
      const match = line.match(/^([a-z_]+):[ \t]*(.*?)\s*$/);
      if (!match || !keys.has(match[1])) continue;
      if (seen.has(match[1])) { delete metadata[match[1] as keyof ImportMetadata]; warnings.push(`Repeated ${match[1]} stays in the original text only.`); continue; }
      seen.add(match[1]);
      let value = match[2];
      if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { continue; } }
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
      if (typeof value !== 'string' || !value || /^[!&*|>{[]/.test(value)) continue;
      const limit = match[1] === 'title' || match[1] === 'source_name' ? 300 : 2000;
      if (Array.from(value).length <= limit) metadata[match[1] as keyof Omit<ImportMetadata, 'provider' | 'original_updated_at'>] = value;
    }
    if (metadata.created_at) {
      const date = metadata.created_at;
      const iso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(date);
      const parsed = Date.parse(date);
      const validDay = iso && !Number.isNaN(parsed) && new Date(`${date.slice(0, 10)}T00:00:00Z`).toISOString().startsWith(date.slice(0, 10));
      if (!iso || !validDay || parsed > now || parsed < Date.parse('0001-01-01T00:00:00Z')) {
        delete metadata.created_at; warnings.push('The date could not be verified from the file; the import date will be used.');
      }
    }
    if (metadata.source_type || metadata.source_name || metadata.source_url || metadata.source_context) {
      const validType = ['book', 'article', 'conversation', 'project', 'other'].includes(metadata.source_type ?? '');
      let validUrl = !metadata.source_url;
      if (metadata.source_url) { try { const url = new URL(metadata.source_url); validUrl = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !/\s/.test(metadata.source_url); if (validUrl) metadata.source_url = url.href; } catch {} }
      if (!validType || !validUrl || !metadata.source_name && !metadata.source_url) {
        for (const key of ['source_type', 'source_name', 'source_url', 'source_context'] as const) delete metadata[key];
        warnings.push('Incomplete source information stays in the original text for you to review later.');
      }
    }
  }
  return { filename, content, metadata, warnings, size: bytes.length };
}

export type ImportResult = { status: 'imported' | 'skipped'; id: string };
export type ImportItem = { filename: string; draft?: ImportDraft; status: 'ready' | 'imported' | 'skipped' | 'failed'; message?: string; id?: string };

const keepStem = (filename: string) => filename.replace(/\.(json|html)$/i, '').normalize('NFC');
export async function reviewImportFiles<T extends { name: string }>(assets: T[], read: (asset: T) => Promise<ImportDraft>, progress: (items: ImportItem[], done: number) => void, stopped: () => boolean = () => false) {
  if (assets.length > MAX_IMPORT_FILES) throw new Error('Choose up to 20 files at a time. Nothing has been imported.');
  const items: (ImportItem | undefined)[] = Array(assets.length);
  // Read JSON first, regardless of picker order. A valid paired JSON means its
  // HTML need not be loaded at all. Review still follows the selection order.
  const ordered = assets.map((asset, index) => ({ asset, index })).sort((a, b) => Number(/\.json$/i.test(b.asset.name)) - Number(/\.json$/i.test(a.asset.name)));
  let bytes = 0; let done = 0;
  for (const { asset, index } of ordered) {
    if (stopped()) break;
    const pair = /\.html$/i.test(asset.name) ? items.find(item => item?.status === 'ready' && item.draft?.metadata.provider === 'google_keep' && /\.json$/i.test(item.filename) && keepStem(item.filename) === keepStem(asset.name)) : undefined;
    if (pair) items[index] = { filename: asset.name, status: 'skipped', message: `Paired with ${pair.filename}; using JSON once to preserve the original dates and checklist.` };
    else {
      try {
        const draft = await read(asset);
        if (bytes + draft.size > MAX_BATCH_BYTES) throw new Error('This batch has reached 2 MB. Import this file in another batch.');
        bytes += draft.size;
        if (/\.html$/i.test(asset.name) && assets.some(other => /\.json$/i.test(other.name) && keepStem(other.name) === keepStem(asset.name))) draft.warnings.push('The paired JSON could not be read; this HTML version will be used instead.');
        items[index] = { filename: asset.name, draft, status: 'ready' };
      } catch (cause) { items[index] = { filename: asset.name, status: 'failed', message: cause instanceof Error ? cause.message : 'This file could not be read. Choose it again.' }; }
    }
    progress(items.filter((item): item is ImportItem => Boolean(item)), ++done);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return items.filter((item): item is ImportItem => Boolean(item));
}
export async function runImport(items: ImportItem[], save: (draft: ImportDraft) => Promise<ImportResult>, progress: (items: ImportItem[], done: number) => void, stopped: () => boolean = () => false) {
  const result = items.map(item => ({ ...item }));
  for (let i = 0; i < result.length; i++) {
    if (stopped()) break;
    const item = result[i];
    if (item.draft && (item.status === 'ready' || item.status === 'failed')) {
      try { const saved = await save(item.draft); Object.assign(item, saved, { message: saved.status === 'skipped' ? 'Already in your notes; skipped.' : 'Imported.', id: saved.id }); }
      catch { item.status = 'failed'; item.message = 'Could not finish. Check your connection and retry; successful files are kept.'; }
    }
    progress([...result], i + 1);
  }
  return result;
}
