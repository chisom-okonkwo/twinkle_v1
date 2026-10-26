export const SOURCE_TYPES = ['book', 'article', 'conversation', 'project', 'other'] as const;
export type SourceValues = { source_type: typeof SOURCE_TYPES[number] | null; name: string; url: string; description: string };
export const EMPTY_SOURCE: SourceValues = { source_type: null, name: '', url: '', description: '' };
export function validateSource(values: SourceValues): SourceValues {
  const result: SourceValues = { source_type: values.source_type, name: values.name.trim(), url: values.url.trim(), description: values.description.trim() };
  if (result.source_type === null) return { ...EMPTY_SOURCE };
  if (!SOURCE_TYPES.includes(result.source_type) || !result.name && !result.url) throw new Error('Add a source name or web link.');
  if (Array.from(result.name).length > 300 || Array.from(result.url).length > 2000 || Array.from(result.description).length > 2000) throw new Error('Keep names under 300 characters and links and details under 2,000 characters.');
  if (result.url) {
    let parsed: URL;
    try { parsed = new URL(result.url); } catch { throw new Error('Use a complete http:// or https:// web link.'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || /\s/u.test(result.url)) throw new Error('Use a web link without sign-in information.');
    result.url = parsed.href;
    if (Array.from(result.url).length > 2000) throw new Error('Keep web links under 2,000 characters.');
  }
  return result;
}
// These are literal cues, not inferred attributions. They remain unconfirmed until saved.
// Do not turn a casual mention of a book/person into a claim about the note's origin.
export function suggestSource(content: string): SourceValues | null {
  const match = content.match(/^(Book|Article|Website|Conversation|Project|Source):[ \t]*([^\r\n]{1,300})$/im);
  if (match) {
    const kind = match[1].toLowerCase();
    const source_type = kind === 'website' ? 'article' : kind === 'source' ? 'other' : kind as SourceValues['source_type'];
    const url = /^https?:\/\/\S+$/i.test(match[2]) ? match[2] : '';
    try { return validateSource({ source_type, name: url ? '' : match[2], url, description: '' }); } catch { return null; }
  }
  return null;
}
