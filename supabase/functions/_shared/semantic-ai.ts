import { normalizeContextInput } from "./context-contract.ts";
import { structured, type RelatedAIConfig } from "./related-ai.ts";
import {
  SEMANTIC_GROUP_INSTRUCTIONS,
  SEMANTIC_GROUP_SCHEMA,
  validateSemanticGroups,
  SEMANTIC_VERIFY_INSTRUCTIONS,
  validateSemanticVerification,
  type SemanticNote,
  type SemanticKnown,
} from "./semantic-groups.ts";
export type SemanticUsage = { input_tokens: number; output_tokens: number };
export async function analyzeSemanticGroups(
  notes: SemanticNote[],
  cores: string[][],
  known: SemanticKnown[],
  config: RelatedAIConfig,
  onUsage: (usage: SemanticUsage) => void,
  fetcher: typeof fetch = fetch,
) {
  if (notes.length < 2) return { groups: [] };
  if (notes.length > 24 || cores.length > 4) throw new Error("invalid_output");
  const metered: typeof fetch = async (input, init) => {
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (cause) {
      onUsage({ input_tokens: 0, output_tokens: 0 });
      throw cause;
    }
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      body?.usage &&
      Number.isInteger(body.usage.input_tokens) &&
      Number.isInteger(body.usage.output_tokens)
    )
      onUsage({
        input_tokens: body.usage.input_tokens,
        output_tokens: body.usage.output_tokens,
      });
    else onUsage({ input_tokens: 0, output_tokens: 0 });
    if (response.ok && body?.status !== "completed")
      throw new Error(
        "invalid_output:" +
          (["incomplete", "failed"].includes(body?.status)
            ? body.status
            : "response_status"),
      );
    if (
      body?.output?.some((item: { content?: { type: string }[] }) =>
        item.content?.some((c) => c.type === "refusal"),
      )
    )
      throw new Error("invalid_output:refusal");
    return response;
  };
  // Short closed-set references reduce copying errors and avoid sending hashes.
  const local = notes.map((n, i) => ({ ...n, id: `n${i}` }));
  const toLocal = new Map(notes.map((n, i) => [n.id, local[i].id]));
  const localCores = cores.map((core) => core.map((id) => toLocal.get(id)!));
  const localKnown = known.map((theme, i) => ({ ...theme, id: `t${i}` }));
  const safe = local.map(({ hash: _hash, ...note }) =>
    Object.fromEntries(
      Object.entries(note).map(([k, v]) => [
        k,
        typeof v === "string" && k !== "id" ? normalizeContextInput(v) : v,
      ]),
    ),
  );
  const schema = JSON.parse(JSON.stringify(SEMANTIC_GROUP_SCHEMA));
  const item = schema.properties.groups.items;
  item.properties.existing_id.enum = [null, ...localKnown.map((t) => t.id)];
  // Encode the coherence constraint in the provider schema as well as validating
  // it locally. A response cannot mix members from separate candidate cores.
  schema.properties.groups.items = {
    anyOf: localCores.map((core) => {
      const variant = JSON.parse(JSON.stringify(item));
      variant.properties.members.items.properties.id.enum = core;
      variant.properties.members.maxItems = core.length;
      return variant;
    }),
  };
  const raw = await structured(
    SEMANTIC_GROUP_INSTRUCTIONS,
    { notes: safe, cores: localCores, knownThemes: localKnown },
    schema,
    "semantic_note_groups",
    config,
    metered,
    6000,
    30000,
  );
  const proposed = validateSemanticGroups(raw, local, localCores, localKnown);
  let verified: {
    groups: typeof proposed.groups;
    verification: {
      proposal_count: number;
      rejected_members: number;
      rejected_groups: number;
    };
  } = {
    ...proposed,
    verification: {
      proposal_count: 0,
      rejected_members: 0,
      rejected_groups: 0,
    },
  };
  if (proposed.groups.length) {
    const verificationSchema = {
      type: "object",
      additionalProperties: false,
      required: ["decisions"],
      properties: {
        decisions: {
          type: "array",
          minItems: proposed.groups.length,
          maxItems: proposed.groups.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["group_id", "label_supported", "members"],
            properties: {
              group_id: {
                type: "string",
                enum: proposed.groups.map((_, i) => `g${i}`),
              },
              label_supported: { type: "boolean" },
              members: {
                type: "array",
                minItems: 2,
                maxItems: 24,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "supported"],
                  properties: {
                    id: { type: "string", enum: local.map((n) => n.id) },
                    supported: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
    };
    const decisions = await structured(
      SEMANTIC_VERIFY_INSTRUCTIONS,
      {
        notes: safe,
        groups: proposed.groups.map((g, i) => ({ ...g, group_id: `g${i}` })),
      },
      verificationSchema,
      "verified_theme_members",
      config,
      metered,
      4000,
      30000,
    );
    verified = validateSemanticVerification(decisions, proposed.groups);
  }
  return {
    ...verified,
    groups: verified.groups.map((group) => ({
      ...group,
      existing_id:
        group.existing_id === null
          ? null
          : known[localKnown.findIndex((t) => t.id === group.existing_id)].id,
      members: group.members.map((member) => ({
        ...member,
        id: notes[local.findIndex((n) => n.id === member.id)].id,
      })),
    })),
  };
}
