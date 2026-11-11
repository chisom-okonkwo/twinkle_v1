# Twinkle delivery hub

The [private Twinkle delivery hub](https://twinkle-delivery-hub.boomingraccoon.chatgpt.site) brings the current specifications and implementation into one practical plan for the next pass.

## Audit scope — 10 November 2026

The hub compares [Twinkle Spec](https://www.notion.so/36a3d7c048178031a2a6e74f4c3b0e0d), [Twinkle Scenario Spec](https://www.notion.so/3c43d7c0481780fb9b38ec750b68eaac), and [Functional Requirement](https://www.notion.so/3f93d7c0481780f89d9ae403746df4a7) with both repository specifications and the local working tree based on commit `be4988ccd0511b48a50fc1418c8d5dc371745131`.

The audit includes the existing uncommitted Still interface and collection changes. Captured source files identify local changes separately from committed files. A static audit does not establish the state of the deployed backend or replace physical-device review.

## Findings and proposed next pass

- 34 normalized capabilities: 22 represented in code, 2 partially covered and 10 missing/deferred. These are coverage counts, not release-readiness percentages.
- Requirement IDs collide: Notion FR-01 means text capture while V1 FR-01 means authentication; Notion FR-13 means stages while Phase 2 FR-13 means search. The hub preserves each namespace.
- Phase 2 FR-13–22 have corresponding implementation paths. Do not rebuild them merely because an older proposed implementation order calls them next.
- The latest Spec asks for a conversation from “Explore this thought.” Current routes offer discovery and grounded reflection, with no multi-turn chat. Resolve this product decision before assigning implementation.
- The `/preview` calendar and sample controls are not evidence of live calendar integration, pinning, categories or rich-block authoring. File import is not connected Notion import.

The proposed five-step MVP backlog is:

1. Freeze a release contract and resolve scope, Explore semantics and unsaved-draft expectations.
2. Walk capture → find → revisit on the current Android development build; fix only reproduced blockers.
3. Verify owner isolation, network/stale-write recovery, exclusions and notification controls.
4. Make Explore labels and routes match the explicitly chosen behavior; full chat requires a separate assignment.
5. Record acceptance and limitations, rerun checks, and commit/push the accepted app pass.

The hub provides exact file/route references, acceptance checks, unresolved decisions, an implementation checklist and a lightweight progress view. Progress and decision edits are stored only in the visitor’s browser; JSON backup/import and a Markdown delivery brief are available. It does not synchronize to GitHub or Notion.

## Verification

For this audit, `npm run lint`, `npm run typecheck` and `npm test` passed: 131 tests passed, 5 optional live-service tests skipped, 0 failed. Browser preview checks covered requirement search, acceptance/source details, checklist/source/decision views, checkbox persistence after reload and prevention of premature task completion.

No mobile application code, backend data, secrets or Notion source pages were changed by the hub work. The latest Android interface review and physical iOS behavior remain unverified; historical capability confirmations are distinguished from this pass’s acceptance.

The Site source is maintained in its own Sites repository on `main`; its isolated local checkout is `.codex-sites/twinkle-delivery-hub/`. Follow the existing app workflow before committing the unrelated interface work documented in [STILL-DESIGN.md](STILL-DESIGN.md).
