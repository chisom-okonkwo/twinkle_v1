import { semanticAdmin, semanticRpc } from "./semantic-db.ts";
export { semanticAdmin, semanticRpc } from "./semantic-db.ts";
import { retrySemanticWrite } from "./semantic-retry.ts";
import { type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  embedNotes,
  EMBEDDING_MODEL,
  SemanticProviderError,
  type EmbeddingClaim,
} from "./semantic-embeddings.ts";

export async function indexSemanticNotes(
  admin: SupabaseClient,
  userId: string,
  token: string,
) {
  const claims = (await semanticRpc(admin, "claim_semantic_embeddings", {
    caller_id: userId,
    run_token: token,
  })) as EmbeddingClaim[];
  if (!claims.length) return { indexed: 0, calls: 0, tokens: 0 };
  const callId = crypto.randomUUID(),
    started = Date.now();
  let observedTokens = 0,
    attempted = false;
  try {
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) throw new SemanticProviderError("provider");
    attempted = true;
    const result = await embedNotes(claims, key);
    observedTokens = result.tokens;
    await retrySemanticWrite(() =>
      semanticRpc(admin, "record_semantic_usage", {
        caller_id: userId,
        call_id: callId,
        kind: "embedding",
        model: EMBEDDING_MODEL,
        input_tokens: result.tokens,
        elapsed_ms: Date.now() - started,
      }),
    );
    const count = await retrySemanticWrite(() =>
      semanticRpc(admin, "finish_semantic_embeddings", {
        caller_id: userId,
        results: result.vectors,
      }),
    );
    return { indexed: Number(count), calls: 1, tokens: result.tokens };
  } catch (cause) {
    await semanticRpc(admin, "record_semantic_usage", {
      caller_id: userId,
      call_id: callId,
      kind: "embedding",
      model: EMBEDDING_MODEL,
      request_count: attempted ? 1 : 0,
      input_tokens: observedTokens,
      elapsed_ms: Date.now() - started,
    }).catch(() => {});
    await semanticRpc(admin, "fail_semantic_embeddings", {
      caller_id: userId,
      claims: claims.map(({ input: _input, ...c }) => c),
      failure: cause instanceof SemanticProviderError ? cause.code : "provider",
    }).catch(() => {});
    throw new Error(
      cause instanceof SemanticProviderError ? cause.code : "persistence",
    );
  }
}
export async function processSemanticRun(
  admin: SupabaseClient,
  userId: string,
  token: string,
  scope = "all",
) {
  const deadline = Date.now() + 90000;
  try {
    await semanticRpc(admin, "begin_semantic_scope", {
      caller_id: userId,
      run_token: token,
      scope,
    });
    const result = await indexSemanticNotes(admin, userId, token);
    const refreshed = await semanticRpc(
      admin,
      "refresh_semantic_relation_batch",
      { caller_id: userId },
    );
    const model =
      Deno.env.get("OPENAI_THEME_MODEL") ??
      Deno.env.get("OPENAI_RELATED_MODEL") ??
      Deno.env.get("OPENAI_CONTEXT_MODEL") ??
      "gpt-6-luna";
    // Drain already planned work first so slow candidate scans cannot starve it.
    const prior = await validateSemanticJobs(
      admin,
      userId,
      scope,
      token,
      model,
      deadline,
    );
    const plan = await planSemanticGroups(
      admin,
      userId,
      scope,
      model,
      deadline,
    );
    const next = await validateSemanticJobs(
      admin,
      userId,
      scope,
      token,
      model,
      deadline,
    );
    const evaluated = {
      validation_calls: prior.validation_calls + next.validation_calls,
      cached_validations: prior.cached_validations + next.cached_validations,
    };
    const diagnostics = {
      ...result,
      ...plan,
      ...evaluated,
      relations_refreshed: refreshed,
    };
    await semanticRpc(admin, "end_semantic_run", {
      caller_id: userId,
      run_token: token,
      diagnostics,
    });
    await semanticRpc(admin, "finish_semantic_work", {
      caller_id: userId,
      scope,
      run_token: token,
    });
    return diagnostics;
  } catch (cause) {
    const failure = cause instanceof Error ? cause.message : "processing";
    await semanticRpc(admin, "end_semantic_run", {
      caller_id: userId,
      run_token: token,
      failure,
    }).catch(() => {});
    await semanticRpc(admin, "finish_semantic_work", {
      caller_id: userId,
      scope,
      run_token: token,
    }).catch(() => {});
    return { failed: true };
  }
}

import { planSemanticGroups } from "./semantic-planning.ts";
import { analyzeSemanticGroups, type SemanticUsage } from "./semantic-ai.ts";
import type { SemanticNote, SemanticKnown } from "./semantic-groups.ts";
async function validateSemanticJobs(
  admin: SupabaseClient,
  userId: string,
  scope: string,
  token: string,
  model: string,
  deadline: number,
) {
  let calls = 0,
    cached = 0;
  for (let i = 0; i < 3 && Date.now() < deadline - 65000; i++) {
    const job = await semanticRpc(admin, "claim_semantic_group", {
      caller_id: userId,
      scope,
      run_token: token,
    });
    if (!job || job.status === "budget") break;
    let usage: SemanticUsage = { input_tokens: 0, output_tokens: 0 };
    const callId = crypto.randomUUID(),
      started = Date.now();
    let recorded = false,
      requests = 0;
    try {
      if (job.status !== "validated") {
        const nodes = job.nodes as SemanticNote[];
        if (nodes.some((n) => !n) || nodes.length > 24)
          throw new Error("persistence");
        const result = await analyzeSemanticGroups(
          nodes,
          job.cores,
          job.known as SemanticKnown[],
          { key: Deno.env.get("OPENAI_API_KEY")!, model },
          (value) => {
            requests++;
            calls++;
            usage.input_tokens += value.input_tokens;
            usage.output_tokens += value.output_tokens;
          },
        );
        await retrySemanticWrite(() =>
          semanticRpc(admin, "record_semantic_usage", {
            caller_id: userId,
            call_id: callId,
            kind: "validation",
            model,
            request_count: requests,
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            elapsed_ms: Date.now() - started,
          }),
        );
        recorded = true;
        const valid = await retrySemanticWrite(() =>
          semanticRpc(admin, "cache_semantic_validation", {
            caller_id: userId,
            target_job: job.id,
            claim_token: job.token,
            result,
          }),
        );
        if (!valid) continue;
      } else cached++;
      await retrySemanticWrite(() =>
        semanticRpc(admin, "persist_semantic_validation", {
          caller_id: userId,
          target_job: job.id,
          claim_token: job.token,
        }),
      );
    } catch (cause) {
      if (!recorded && job.status !== "validated")
        await semanticRpc(admin, "record_semantic_usage", {
          caller_id: userId,
          call_id: callId,
          kind: "validation",
          model,
          request_count: requests,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          elapsed_ms: Date.now() - started,
        }).catch(() => {});
      const reason =
        cause instanceof Error && cause.message.startsWith("invalid_output:")
          ? cause.message
          : cause instanceof Error && cause.message === "invalid_result"
            ? "invalid_output:response"
            : cause instanceof Error && cause.message === "persistence"
              ? "persistence"
              : "provider";
      await semanticRpc(admin, "fail_semantic_group", {
        caller_id: userId,
        target_job: job.id,
        claim_token: job.token,
        failure: reason,
      }).catch(() => {});
      throw new Error(reason);
    }
  }
  return { validation_calls: calls, cached_validations: cached };
}
