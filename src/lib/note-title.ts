export const MAX_NOTE_TITLE_LENGTH = 300;

export function normalizeNoteTitle(value: string) {
  const title = value.replace(/\s+/gu, ' ').trim();
  if (Array.from(title).length > MAX_NOTE_TITLE_LENGTH || /[\x00-\x1f\x7f]/.test(title)) {
    throw new Error('Keep the title to 300 characters on one line.');
  }
  return title;
}

export function notePresentation(note: { title?: string | null; content: string; capture_method: string }) {
  const lines = note.content.trim().split(/\r?\n/);
  const explicit = note.title?.trim();
  const title = explicit || (lines[0]
    ? lines[0].slice(0, 160) + (lines[0].length > 160 ? '…' : '')
    : note.capture_method === 'image' ? 'Photo note' : note.capture_method === 'audio' ? 'Audio note' : 'Note with attachments');
  return { title, preview: (explicit ? lines : lines.slice(1)).join('\n').trim().slice(0, 500) };
}
