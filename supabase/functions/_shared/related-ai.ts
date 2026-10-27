import { LINKS_INSTRUCTIONS, LINKS_SCHEMA, TERMS_INSTRUCTIONS, TERMS_SCHEMA, validateLinks, validateTerms, type RelatedInput } from './related-contract.ts';
export type RelatedAIConfig = { key: string; model: string };
export async function structured(instructions: string, input: unknown, schema: object, name: string, config: RelatedAIConfig, fetcher: typeof fetch, maxOutputTokens = 2200, timeoutMs = 30000) {
  const response = await fetcher('https://api.openai.com/v1/responses', { method: 'POST',
    headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: config.model, store: false, max_output_tokens: maxOutputTokens, reasoning: { effort: 'none' }, instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
      text: { format: { type: 'json_schema', name, strict: true, schema } } }),
  });
  if (!response.ok) throw new Error('provider');
  const data = await response.json();
  if (data.status !== 'completed' || !Array.isArray(data.output)) throw new Error('invalid_result');
  const text = data.output.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []).filter((item: { type: string }) => item.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('');
  try { return JSON.parse(text); } catch { throw new Error('invalid_result'); }
}
export async function relatedTerms(origin: RelatedInput, config: RelatedAIConfig, fetcher: typeof fetch = fetch) {
  return validateTerms(await structured(TERMS_INSTRUCTIONS, origin, TERMS_SCHEMA, 'related_terms', config, fetcher));
}
export async function relatedLinks(origin: RelatedInput, candidates: RelatedInput[], config: RelatedAIConfig, fetcher: typeof fetch = fetch) {
  if (!candidates.length) return [];
  return validateLinks(await structured(LINKS_INSTRUCTIONS, { origin, candidates }, LINKS_SCHEMA, 'related_links', config, fetcher), origin, candidates);
}
