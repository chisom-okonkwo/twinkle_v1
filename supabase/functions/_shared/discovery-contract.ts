import { rankRecallNotes, type RecallCandidate } from './recall-contract.ts';
export type DiscoveryRequest = { mode: 'surprise' | 'topic'; topic: string; sessionId: string; requestId: string };
export function validateDiscoveryRequest(input: unknown): DiscoveryRequest {
  if (!input || typeof input !== 'object') throw new Error('invalid_request');
  const value = input as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!['surprise','topic'].includes(String(value.mode)) || typeof value.sessionId !== 'string' || !uuid.test(value.sessionId) || typeof value.requestId !== 'string' || !uuid.test(value.requestId) || typeof value.topic !== 'string' || Array.from(value.topic).length > 200 || Object.keys(value).some(k=>!['mode','topic','sessionId','requestId'].includes(k))) throw new Error('invalid_request');
  const topic = value.topic.replace(/\s+/gu,' ').trim();
  if (value.mode === 'topic' && !/[\p{L}\p{N}]/u.test(topic)) throw new Error('Choose a topic to explore.');
  return { mode: value.mode as DiscoveryRequest['mode'], topic, sessionId: value.sessionId, requestId: value.requestId };
}
export type DiscoveryCandidate = RecallCandidate & { last_seen_at?: string | null };
export function rankDiscovery(notes: DiscoveryCandidate[], sessionId: string, now = Date.now()) {
  // Recall's scoring and grounding, with a gentler age/meaningfulness threshold for intentional exploration.
  const variety = (id: string) => [...id + sessionId].reduce((hash, c) => (Math.imul(hash,31) + c.charCodeAt(0)) >>> 0, 0) / 4294967296 / 4;
  const tier = (note: RecallCandidate) => {
    const seen = Date.parse((note as DiscoveryCandidate).last_seen_at ?? '');
    if (Number.isFinite(seen) && now-seen < 7*86400000) return 2;
    return now-Date.parse(note.created_at) >= 86400000 && now-Date.parse(note.updated_at) >= 86400000 ? 0 : 1;
  };
  return rankRecallNotes(notes, now, 'discovery').sort((a,b)=> tier(a.note)-tier(b.note) || (b.score + variety(b.note.id)) - (a.score + variety(a.note.id)) || a.note.id.localeCompare(b.note.id));
}

export function validateCaptureSeen(value: unknown): { originId: string; noteIds: string[] } {
  if (!value || typeof value !== 'object') throw new Error('invalid_request');
  const v = value as Record<string,unknown>, uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (v.action !== 'capture_seen' || typeof v.originId !== 'string' || !uuid.test(v.originId) || !Array.isArray(v.noteIds) || v.noteIds.length > 2 || v.noteIds.some(id=>typeof id !== 'string' || !uuid.test(id) || id===v.originId) || Object.keys(v).some(k=>!['action','originId','noteIds'].includes(k))) throw new Error('invalid_request');
  return {originId:v.originId,noteIds:[...new Set(v.noteIds)]};
}
