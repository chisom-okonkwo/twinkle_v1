import { Parser } from 'htmlparser2';
import type { ImportMetadata } from './import-contract.ts';

type KeepNote = { content: string; metadata: ImportMetadata; warnings: string[] };
const attachmentWarning = 'Attachments are not imported from Keep files. Only the text below will be saved; you can add photos or audio to the note afterward.';
const invalidExport = 'This is not a supported Google Keep note export.';

function exportDate(value: unknown, now: number): string | undefined {
  // Takeout stores microseconds, not milliseconds. Never use a filename or
  // the device file's modification time as a historical creation date.
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) return;
  const millis = Math.floor(number / 1000);
  if (millis > now) return;
  return new Date(millis).toISOString();
}

export function readKeepJson(source: string, now: number): KeepNote {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('This Keep JSON file is damaged or incomplete.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(invalidExport);
  const note = value as Record<string, unknown>;
  if (typeof note.title !== 'string' ||
    !['isArchived', 'isPinned', 'isTrashed'].some(key => typeof note[key] === 'boolean') ||
    !('textContent' in note || 'listContent' in note)) throw new Error(invalidExport);
  if (note.textContent !== undefined && typeof note.textContent !== 'string' ||
    note.listContent !== undefined && !Array.isArray(note.listContent) ||
    note.attachments !== undefined && !Array.isArray(note.attachments)) throw new Error(invalidExport);
  const warnings: string[] = [];
  const metadata: ImportMetadata = { provider: 'google_keep', title: note.title };
  const created = exportDate(note.createdTimestampUsec, now);
  const modified = exportDate(note.userEditedTimestampUsec, now);
  if (created) metadata.created_at = created;
  else warnings.push('No reliable original creation date was found. The import date will be used.');
  if (modified && (!created || modified >= created)) metadata.original_updated_at = modified;
  else if (note.userEditedTimestampUsec !== undefined) warnings.push('The original modification date could not be verified and will not be kept.');
  if (Array.isArray(note.attachments) && note.attachments.length) warnings.push(attachmentWarning);
  if (note.isTrashed === true) throw new Error('This Keep note is in the trash. Restore it in Keep before importing it.');
  if (note.isArchived === true) warnings.push('Archived in Keep; this will become an ordinary Twinkle note.');
  let content = (note.textContent as string | undefined) ?? '';
  if (Array.isArray(note.listContent) && note.listContent.length) {
    const checklist = note.listContent.map(item => {
      if (!item || typeof item !== 'object' || typeof item.text !== 'string' || typeof item.isChecked !== 'boolean') {
        throw new Error('This Keep checklist contains an unreadable item or completion state.');
      }
      return `- [${item.isChecked ? 'x' : ' '}] ${item.text.replace(/\n/g, '\n  ')}`;
    }).join('\n');
    content = content ? `${content}\n\n${checklist}` : checklist;
  }
  if (!content.trim()) throw new Error('This Keep note has no text to import. Attachments cannot be imported from these files.');
  return { content, metadata, warnings };
}

type HtmlNode = { tag: string; attrs: Record<string, string>; children: (HtmlNode | string)[] };
const excluded = new Set(['script', 'style', 'head', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'form']);
const blocks = new Set(['div', 'p', 'section', 'article', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol']);
function hasClass(node: HtmlNode, name: string) { return (node.attrs.class ?? '').split(/\s+/).includes(name); }
function hidden(node: HtmlNode) {
  return excluded.has(node.tag) || 'hidden' in node.attrs || node.attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.attrs.style ?? '');
}
function find(root: HtmlNode, match: (node: HtmlNode) => boolean, includeHidden = false): HtmlNode[] {
  const result: HtmlNode[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (!includeHidden && hidden(node)) continue;
    if (match(node)) result.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (typeof child !== 'string') pending.push(child);
    }
  }
  return result;
}
function childrenText(node: HtmlNode): string {
  let text = ''; let previousBlock = false;
  for (const child of node.children) {
    const value = typeof child === 'string' ? child : plainText(child);
    const block = typeof child !== 'string' && blocks.has(child.tag);
    if (text && value && (block || previousBlock) && !text.endsWith('\n') && !value.startsWith('\n')) text += '\n';
    text += value;
    if (value) previousBlock = block;
  }
  return text;
}
function plainText(node: HtmlNode): string {
  if (hidden(node) || hasClass(node, 'bullet') || node.tag === 'input') return '';
  if (node.tag === 'br') return '\n';
  if (node.tag === 'ul' || node.tag === 'ol') {
    return node.children.filter(child => typeof child !== 'string' || child.trim()).map(child => typeof child === 'string' ? child : plainText(child)).join('\n');
  }
  if (node.tag === 'li') {
    // Export templates may indent the bullet and text spans. That template
    // whitespace is not part of the checklist item itself.
    const itemText = node.children.filter((child): child is HtmlNode => typeof child !== 'string' && hasClass(child, 'text'));
    const value = itemText.length ? itemText.map(plainText).join('') : childrenText(node);
    if (!hasClass(node, 'listitem')) return `- ${value.replace(/\n/g, '\n  ')}`;
    const checked = hasClass(node, 'checked') || find(node, item => hasClass(item, 'bullet')).some(bullet => childrenText(bullet).includes('☑'));
    return `- [${checked ? 'x' : ' '}] ${value.replace(/\n/g, '\n  ')}`;
  }
  return childrenText(node);
}

export function readKeepHtml(source: string): KeepNote {
  // Pure token parsing: no WebView, DOM insertion, script execution, URL fetch,
  // CSS loading, or external entity resolution. Bound tree size and recursion.
  const root: HtmlNode = { tag: 'root', attrs: {}, children: [] };
  const stack = [root]; let count = 0;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (++count > 20_000 || stack.length > 64) throw new Error('This HTML file is too complex to import safely. Choose its JSON version.');
      const node = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node); stack.push(node);
    },
    ontext(text) { stack[stack.length - 1].children.push(text); },
    onclosetag() { stack.pop(); },
  }, { decodeEntities: true });
  parser.end(source);
  const notes = find(root, node => hasClass(node, 'note'));
  if (notes.length !== 1) throw new Error(invalidExport);
  const contents = find(notes[0], node => hasClass(node, 'content'));
  if (contents.length !== 1) throw new Error(invalidExport);
  const titles = notes[0].children.filter((child): child is HtmlNode => typeof child !== 'string' && hasClass(child, 'title') && !hidden(child));
  if (titles.length > 1) throw new Error(invalidExport);
  const content = plainText(contents[0]);
  if (!content.trim()) throw new Error('This Keep note has no text to import. Attachments cannot be imported from these files.');
  const warnings = ['Keep HTML does not contain a reliable original creation date. The import date will be used; choose JSON to keep original dates.'];
  if (find(notes[0], node => hasClass(node, 'attachments') || ['img', 'audio', 'video', 'object', 'embed'].includes(node.tag), true).length) warnings.push(attachmentWarning);
  return { content, metadata: { provider: 'google_keep', ...(titles[0] ? { title: plainText(titles[0]) } : {}) }, warnings };
}
