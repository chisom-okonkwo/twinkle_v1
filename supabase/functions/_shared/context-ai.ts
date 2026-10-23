import { CONTEXT_INSTRUCTIONS, CONTEXT_SCHEMA, validateContextAnalysis } from './context-contract.ts';

export async function analyzeContext(content: string, config: { key: string; model: string }, fetcher: typeof fetch = fetch) {
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(65000),
    body: JSON.stringify({ model: config.model, store: false, max_output_tokens: 6000, reasoning: { effort: 'none' },
      instructions: CONTEXT_INSTRUCTIONS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: content }] }],
      text: { format: { type: 'json_schema', name: 'note_context', strict: true, schema: CONTEXT_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 || response.status === 404 ? 'configuration' : 'provider');
  const data = await response.json();
  if (data.status !== 'completed' || !Array.isArray(data.output)) throw new Error('invalid_result');
  const text = data.output.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
    .filter((item: { type: string }) => item.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('');
  try { return validateContextAnalysis(JSON.parse(text), content); }
  catch { throw new Error('invalid_result'); }
}
