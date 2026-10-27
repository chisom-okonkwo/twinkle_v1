export type SimilarityEdge = {
  a: string;
  b: string;
  similarity: number;
  related?: boolean;
};
export const CANDIDATE_SIMILARITY = 0.42;
export const COHERENCE_FLOOR = 0.3;
// These are retrieval heuristics calibrated on explicit positive/negative
// examples, not probabilities or membership decisions. AI validates every member.
export function coherentCandidateSets(
  ids: string[],
  edges: SimilarityEdge[],
  focusIds = ids,
) {
  const similarity = new Map<string, SimilarityEdge>();
  const key = (a: string, b: string) => [a, b].sort().join(":");
  for (const edge of edges)
    if (
      edge.a !== edge.b &&
      Number.isFinite(edge.similarity) &&
      edge.similarity >= -1 &&
      edge.similarity <= 1
    )
      similarity.set(key(edge.a, edge.b), edge);
  const candidates: string[][] = [];
  const used = new Set<string>();
  for (const origin of focusIds) {
    if (!ids.includes(origin)) continue;
    const neighbours = ids
      .filter((id) => id !== origin)
      .map((id) => ({ id, edge: similarity.get(key(origin, id)) }))
      .filter(
        (n) =>
          n.edge &&
          (n.edge.related || n.edge.similarity >= CANDIDATE_SIMILARITY),
      )
      .sort(
        (a, b) =>
          Number(b.edge!.related ?? false) - Number(a.edge!.related ?? false) ||
          b.edge!.similarity - a.edge!.similarity ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 12);
    const group = [origin];
    for (const n of neighbours) {
      const links = group.map((id) => similarity.get(key(id, n.id)));
      if (
        links.some((e) => !e || (!e.related && e.similarity < COHERENCE_FLOOR))
      )
        continue;
      if (
        links.reduce((sum, e) => sum + e!.similarity, 0) / links.length <
          CANDIDATE_SIMILARITY &&
        !links.some((e) => e?.related)
      )
        continue;
      group.push(n.id);
    }
    const canonical = [...group].sort().join(":");
    if (group.length >= 2 && !used.has(canonical)) {
      used.add(canonical);
      candidates.push(group);
    }
  }
  return candidates.sort(
    (a, b) =>
      b.length - a.length ||
      [...a]
        .sort()
        .join(":")
        .localeCompare([...b].sort().join(":")),
  );
}
