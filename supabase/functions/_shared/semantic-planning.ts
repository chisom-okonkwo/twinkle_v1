import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  coherentCandidateSets,
  CANDIDATE_SIMILARITY,
  type SimilarityEdge,
} from "./semantic-candidates.ts";
import { semanticRpc } from "./semantic-db.ts";
import type { SemanticNote } from "./semantic-groups.ts";
export async function planSemanticGroups(
  admin: SupabaseClient,
  userId: string,
  scope: string,
  model: string,
  deadline: number,
) {
  const anchors = (await semanticRpc(admin, "semantic_scope_anchors", {
    caller_id: userId,
    scope,
  })) as { id: string; hash: string }[];
  const cores: string[][] = [];
  let examined = 0,
    retrieved = 0,
    rejected = 0;
  for (const anchor of anchors.slice(0, 8)) {
    if (Date.now() > deadline - 65000) break;
    examined++;
    const graph = (await semanticRpc(admin, "semantic_candidate_graph", {
      target_id: anchor.id,
      caller_id: userId,
      scope,
    })) as { nodes: SemanticNote[]; edges: SimilarityEdge[] };
    const nodes = graph.nodes.filter(Boolean);
    retrieved += Math.max(0, nodes.length - 1);
    const sets = coherentCandidateSets(
      nodes.map((n) => n.id),
      graph.edges,
      [anchor.id],
    );
    const strong = graph.edges.filter(
      (e) =>
        (e.a === anchor.id || e.b === anchor.id) &&
        (e.related || e.similarity >= CANDIDATE_SIMILARITY),
    ).length;
    rejected += Math.max(0, strong - (sets[0]?.length ?? 1) + 1);
    if (!sets.length) {
      await semanticRpc(admin, "mark_semantic_no_candidates", {
        caller_id: userId,
        scope,
        target_id: anchor.id,
        expected_hash: anchor.hash,
      });
      continue;
    }
    for (const set of sets) cores.push([...set].sort());
  }
  // A larger coherent core can validate its narrower subsets in the same call.
  const unique = cores
    .sort(
      (a, b) => b.length - a.length || a.join(":").localeCompare(b.join(":")),
    )
    .filter(
      (core, i, all) =>
        !all
          .slice(0, i)
          .some((prior) => core.every((id) => prior.includes(id))),
    );
  const bundles: string[][][] = [];
  for (const core of unique) {
    let bundle = bundles.find(
      (b) => b.length < 4 && new Set([...b.flat(), ...core]).size <= 24,
    );
    if (!bundle) {
      bundle = [];
      bundles.push(bundle);
    }
    bundle.push(core);
  }
  for (const bundle of bundles)
    await semanticRpc(admin, "enqueue_semantic_group", {
      caller_id: userId,
      scope,
      cores: bundle.sort((a, b) => a.join(":").localeCompare(b.join(":"))),
      model_name: model,
    });
  return {
    anchors: examined,
    candidates_retrieved: retrieved,
    coherence_rejected: rejected,
    candidate_cores: unique.length,
    bundles: bundles.length,
  };
}
