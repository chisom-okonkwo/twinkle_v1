export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export type EmbeddingClaim = {
  id: string;
  token: string;
  hash: string;
  input: string;
};
export class SemanticProviderError extends Error {
  code: "provider" | "invalid_embedding" | "timeout";
  constructor(code: "provider" | "invalid_embedding" | "timeout") {
    super(code);
    this.code = code;
  }
}
export async function embedNotes(
  claims: EmbeddingClaim[],
  key: string,
  fetcher: typeof fetch = fetch,
) {
  if (!claims.length) return { vectors: [], tokens: 0 };
  if (
    claims.length > 32 ||
    claims.some(
      (c) => !c.input || new TextEncoder().encode(c.input).length > 7000,
    )
  )
    throw new SemanticProviderError("invalid_embedding");
  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
        input: claims.map((c) => c.input),
      }),
    });
  } catch {
    throw new SemanticProviderError("timeout");
  }
  if (!response.ok) throw new SemanticProviderError("provider");
  const result = await response.json().catch(() => null);
  if (
    !result ||
    result.model !== EMBEDDING_MODEL ||
    !Array.isArray(result.data) ||
    result.data.length !== claims.length ||
    !Number.isInteger(result.usage?.total_tokens) ||
    result.usage.total_tokens < 0
  )
    throw new SemanticProviderError("invalid_embedding");
  const sorted = [...result.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((item, i) => {
    if (
      item.index !== i ||
      !Array.isArray(item.embedding) ||
      item.embedding.length !== EMBEDDING_DIMENSIONS ||
      item.embedding.some(
        (x: unknown) => typeof x !== "number" || !Number.isFinite(x),
      ) ||
      item.embedding.every((x: number) => x === 0)
    )
      throw new SemanticProviderError("invalid_embedding");
    return { ...claims[i], embedding: item.embedding };
  });
  return {
    vectors: vectors.map(({ input: _input, ...record }) => record),
    tokens: result.usage.total_tokens,
  };
}
