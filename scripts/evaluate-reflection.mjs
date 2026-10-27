// Opt-in live, synthetic-only evaluation. Seed an isolated fixture with the
// cases in tests/fixtures/reflection-evaluation.json; never use a real account.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const file = process.env.TWINKLE_REFLECTION_FIXTURES;
if (!file) throw new Error("Supply a private synthetic fixture file.");
const { users, fixtures } = JSON.parse(await readFile(file, "utf8"));
assert.ok(
  users.length === 4 &&
    users.every((u) =>
      /^twinkle-reflection-[0-9a-f-]+@example\.invalid$/.test(u.email)
    ),
);
const clients = users.map(() =>
  createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
);
const report = [];
async function read(api, id) {
  const r = await api.rpc("read_reflection_experience", {
    kind: "note",
    target_id: id,
  });
  assert.ifError(r.error);
  return r.data;
}
async function runProcessing(api, id, kind) {
  const start = Date.now();
  const request = await api.functions.invoke("note-reflection", {
    body: { kind, targetId: id },
  });
  assert.ifError(request.error);
  if (request.data.status !== "processing") {
    return {
      state: await read(api, id),
      requested: request.data.status,
      ms: Date.now() - start,
    };
  }
  for (let i = 0; i < 65; i++) {
    const state = await read(api, id);
    if (
      kind === "prompt"
        ? state.prompt_status !== "processing"
        : state.status !== "processing"
    ) return { state, ms: Date.now() - start };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Synthetic reflection timed out");
}
try {
  await Promise.all(
    clients.map(async (api, i) =>
      assert.ifError((await api.auth.signInWithPassword(users[i])).error)
    ),
  );
  // Parallel owners, sequential work per owner preserves normal cooldown/limits.
  await Promise.all(clients.map(async (api, user) => {
    for (const c of fixtures.filter((f) => f.user === user)) {
      const compared = await runProcessing(api, c.earlyId, "note");
      const question = await runProcessing(api, c.earlyId, "prompt");
      const row = {
        scenario: c.key,
        expectedKind: c.kind,
        actualKinds: compared.state.comparisons.map((p) => p.kind),
        comparisonCount: compared.state.comparisons.length,
        promptSuggested: Boolean(question.state.prompt),
        promptRequest: question.requested ?? "processed",
        comparisonMs: compared.ms,
        promptMs: question.ms,
        checks: [],
      };
      if (c.kind) {
        assert.ok(
          compared.state.comparisons.some((p) => p.kind === c.kind),
          `Missing ${c.key} comparison`,
        );
      } else {assert.equal(
          row.comparisonCount,
          0,
          `Unsupported ${c.key} comparison`,
        );}
      if (c.question === null) {
        assert.equal(
          row.promptSuggested,
          false,
          `Unnecessary ${c.key} question`,
        ); // A relevant question remains optional even for a positive comparison.
      }
      for (const p of compared.state.comparisons) {
        assert.equal(p.earlier_id, c.earlyId);
        assert.equal(p.later_id, c.lateId);
        assert.ok(c.early.includes(p.earlier_quote));
        assert.ok(c.late.includes(p.later_quote));
      }
      row.checks.push(
        "expected classifications",
        "exact owned evidence",
        "appropriate question",
      );
      if (question.state.prompt && c.key !== "continuity") {
        const prompt = question.state.prompt;
        const content =
          "I plan to apply while I continue learning. I still have questions about the right first internship.";
        const saved = await api.rpc("answer_reflective_prompt", {
          prompt_id: prompt.id,
          body: content,
        });
        assert.ifError(saved.error);
        const repeated = await api.rpc("answer_reflective_prompt", {
          prompt_id: prompt.id,
          body: content,
        });
        assert.ifError(repeated.error);
        assert.equal(repeated.data, saved.data);
        const original = await api.from("notes").select("content").eq(
          "id",
          c.earlyId,
        ).single();
        assert.ifError(original.error);
        assert.equal(original.data.content, c.early);
        const fresh = createClient(
          process.env.EXPO_PUBLIC_SUPABASE_URL,
          process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        assert.ifError(
          (await fresh.auth.signInWithPassword(users[user])).error,
        );
        assert.equal(
          (await read(fresh, c.earlyId)).responses[0].id,
          saved.data,
        );
        assert.ifError(
          (await fresh.from("notes").update({
            content: "I am considering my first applications.",
          }).eq("id", saved.data)).error,
        );
        const searched = await fresh.rpc("search_notes", {
          search_text: "applications",
        });
        assert.ifError(searched.error);
        assert.ok(searched.data.some((n) => n.id === saved.data));
        assert.ifError(
          (await fresh.from("notes").delete().eq("id", saved.data)).error,
        );
        assert.equal((await read(fresh, c.earlyId)).responses.length, 0);
        await fresh.auth.signOut();
        row.checks.push(
          "response idempotency",
          "unchanged original",
          "new-session persistence",
          "response edit/search/delete",
        );
      }
      if (c.key === "continuity" && question.state.prompt) {
        assert.ifError(
          (await api.rpc("dismiss_reflective_prompt", {
            prompt_id: question.state.prompt.id,
          })).error,
        );
        const retry = await api.functions.invoke("note-reflection", {
          body: { kind: "prompt", targetId: c.earlyId },
        });
        assert.ifError(retry.error);
        assert.equal(retry.data.status, "cached");
        assert.equal((await read(api, c.earlyId)).prompt, null);
        row.checks.push("persistent dismissal");
      }
      if (c.key === "unresolved") {
        assert.ifError(
          (await api.from("notes").update({
            content:
              "I decided not to take the course. I will draw on weekends instead.",
          }).eq("id", c.lateId)).error,
        );
        assert.equal((await read(api, c.earlyId)).comparisons.length, 0);
        row.checks.push("edit invalidation");
        assert.ifError(
          (await api.from("notes").delete().eq("id", c.lateId)).error,
        );
        assert.equal((await read(api, c.earlyId)).comparisons.length, 0);
        row.checks.push("delete invalidation");
      }
      report.push(row);
      console.log(
        JSON.stringify({
          scenario: row.scenario,
          comparisons: row.comparisonCount,
          prompt: row.promptSuggested,
          checks: row.checks.length,
        }),
      );
    }
  }));
} finally {
  await Promise.all(
    clients.map((api) => api.auth.signOut({ scope: "global" })),
  );
  await writeFile(
    process.env.TWINKLE_REFLECTION_REPORT ??
      "/tmp/twinkle-reflection-live.json",
    JSON.stringify({ syntheticOnly: true, results: report }, null, 2),
  );
}
