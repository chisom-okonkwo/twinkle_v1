import { AUDIO_INSTRUCTIONS, PHOTO_INSTRUCTIONS, type CaptureKind, type CaptureResult, validateResult } from './capture-contract.ts';

export type AIConfig = { key: string; visionModel: string; audioModel: string; photoInstructions?: string; audioInstructions?: string; imageUrl?: string };
export async function extractMedia(kind: CaptureKind, bytes: Uint8Array, mime: string, config: AIConfig, fetcher: typeof fetch = fetch): Promise<CaptureResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.key}` };
  let body: BodyInit;
  let endpoint: string;
  if (kind === 'image') {
    let imageUrl = config.imageUrl;
    if (!imageUrl) {
      let binary = '';
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      imageUrl = `data:${mime};base64,${btoa(binary)}`;
    }
    headers['Content-Type'] = 'application/json';
    endpoint = 'responses';
    body = JSON.stringify({ model: config.visionModel, store: false, max_output_tokens: 16000,
      instructions: config.photoInstructions ?? PHOTO_INSTRUCTIONS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Extract the visible text for an editable note.' }, { type: 'input_image', image_url: imageUrl, detail: 'high' }] }],
      text: { format: { type: 'json_schema', name: 'note_extraction', strict: true, schema: {
        type: 'object', additionalProperties: false, required: ['text', 'warnings', 'empty'], properties: {
          text: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } }, empty: { type: 'boolean' },
        },
      } } },
    });
  } else {
    endpoint = 'audio/transcriptions';
    const form = new FormData();
    form.set('file', new Blob([bytes.slice().buffer], { type: mime }), mime === 'audio/mp4' ? 'source.m4a' : 'source.webm');
    form.set('model', config.audioModel);
    form.set('prompt', config.audioInstructions ?? AUDIO_INSTRUCTIONS);
    body = form;
  }
  const response = await fetcher(`https://api.openai.com/v1/${endpoint}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(85000) });
  if (!response.ok) {
    if (response.status === 429) throw new Error('AI processing is busy or its quota is exhausted. Your source is safe; try again later.');
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new Error('AI processing needs server configuration. Your source is safe; contact the project administrator.');
    throw new Error('AI processing failed. Your source is safe; please retry.');
  }
  const data = await response.json();
  if (kind === 'audio') {
    if (typeof data.text !== 'string') throw new Error('The transcription response was invalid.');
    const text = data.text.trim();
    return validateResult({ text, empty: !text, warnings: text ? [] : ['No intelligible speech was found. You can record again or type a note.'] });
  }
  if (data.status !== 'completed' || !Array.isArray(data.output)) throw new Error('Image extraction was incomplete. Please retry with the original source.');
  const text = data.output.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []).filter((item: { type: string }) => item.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('');
  try { return validateResult(JSON.parse(text)); }
  catch { throw new Error('Image extraction could not be validated. Please retry with the original source.'); }
}
