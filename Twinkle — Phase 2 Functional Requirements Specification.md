# Twinkle — Phase 2 Functional Requirements Specification

**Document type:** Functional Requirements Specification (FRS)  
**Project:** Twinkle  
**Status:** Proposed for implementation  
**Reference:** Twinkle Scenario Spec  
**Current baseline:** FR-01 through FR-12 implemented  
**New requirements:** FR-13 through FR-30

---

## 1. Purpose

This specification defines the next functional capabilities required to advance Twinkle toward the experiences described in its Scenario Spec.

Phase 1 established the application's foundational capabilities:

- Authentication and private note storage
- Text, photo, and audio note capture
- AI-powered contextual enrichment
- Context metadata and optional contextual prompting
- Intelligent note flashbacks
- Push notifications and user notification preferences

Phase 2 focuses on moving from **individual note intelligence to collection-level intelligence**.

Twinkle should increasingly understand relationships between notes, identify recurring patterns, assist with reflection, and help users transform previously captured thoughts into useful outcomes.

This document defines what the application should be capable of doing, not its final visual design or detailed implementation architecture.

## 2. Priority Definitions

| Priority | Meaning |
|---|---|
| P0 — Build Next | Foundational functionality that unlocks the next major product experiences |
| P1 — High | Important intelligence and discovery features that depend on P0 |
| P2 — Medium | Valuable creative and productivity capabilities to develop once the foundations are reliable |
| P3 — Deferred | Advanced experiences that belong on the roadmap but should not block current progress |

## 3. Phase 2A — Retrieval and Connection

**Priority: P0 — Build Next**

**Goal:** Help users find forgotten information and understand how their notes relate to one another.

This phase directly addresses the disconnected ideas and difficult retrieval described by Maya, Daniel, Lila, and Alina.

### FR-13 — Intelligent Note Search

**Requirement:** Users shall be able to search across their existing notes and retrieve relevant information without manually scrolling through their entire collection.

**Functional capabilities:**

- Search note titles and content.
- Include text extracted from photos and audio recordings.
- Support keyword and phrase searches.
- Use existing contextual metadata to improve relevance where useful.
- Rank results using meaningful content matches rather than recency alone.
- Present enough matching context to identify the correct note.
- Support opening the original note directly from a result.
- Return useful empty states when no relevant notes exist.

**Acceptance criteria:** A user with hundreds of saved notes can retrieve a known note using words or phrases from its content. Searches work across all three capture methods, return only the user's authorized notes, and do not modify their content.

### FR-14 — Note Source and Context Attribution

**Requirement:** Users shall be able to preserve and revisit relevant information about where a note or idea originated.

**Functional capabilities:**

- Optionally associate notes with books, articles, projects, conversations, or other sources.
- Store relevant source titles, references, and URLs.
- Reuse source information explicitly captured during note creation or contextual enrichment.
- Allow users to edit or remove attribution.
- Include source information in search and related-note discovery.
- Distinguish verified user-provided attribution from AI-inferred suggestions.

**Acceptance criteria:** A note captured from a book can retain its book reference, and the user can later retrieve that note using the source information. Missing source information is never fabricated.

### FR-15 — Related Notes Discovery

**Requirement:** Twinkle shall identify meaningful relationships between previously captured notes.

**Functional capabilities:**

- Analyze relationships using note content and existing contextual metadata.
- Identify notes discussing similar topics, concepts, experiences, or questions.
- Support relationships between notes created at different times.
- Provide a concise explanation of why notes may be related.
- Allow users to navigate between connected notes.
- Avoid presenting weak or generic relationships as meaningful connections.
- Update relationships as notes are added, edited, or deleted.

**Acceptance criteria:** Notes about related concepts can be surfaced together even when created months apart. Users can inspect the original notes, and suggested relationships are supported by their actual content.

### FR-16 — Contextual Resurfacing During Note Capture

**Requirement:** Twinkle shall be able to suggest relevant existing notes when a user captures a new, related thought.

**Functional capabilities:**

- Evaluate potential relationships between a newly saved note and existing notes.
- Suggest a small number of relevant older notes.
- Use the same relationship-discovery logic established in FR-15.
- Present suggestions without interrupting capture or blocking saving.
- Allow users to open, dismiss, or ignore suggestions.
- Avoid repeatedly suggesting the same irrelevant connections.
- Respect user preferences and excluded notes.

**Example:** A user creates a note about leadership, and Twinkle identifies a related note captured while reading a different book two years earlier.

**Acceptance criteria:** After a relevant note is created, Twinkle can surface an older related note without requiring a manual search. If no meaningful relationship exists, no suggestion is necessary.

### FR-17 — Contextual Memory and Idea Discovery

**Requirement:** Users shall be able to intentionally explore previously saved notes for inspiration or rediscovery.

**Functional capabilities:**

- Provide an on-demand way to rediscover previously captured ideas.
- Reuse the existing flashback infrastructure where practical.
- Allow discovery by topic, source, or other available context.
- Support occasional unexpected discoveries from eligible older notes.
- Help users revisit relevant ideas without requiring an exact search query.
- Respect existing flashback exclusions and sensitivity preferences.

**Acceptance criteria:** A user can initiate a discovery session and receive previously saved notes appropriate to the chosen context. Users can open the original notes and are not shown deleted or excluded content.

### FR-18 — Historical Note Import

**Requirement:** Users shall be able to bring existing note collections into Twinkle without manually recreating every note.

**Functional capabilities:**

- Support a practical initial import format, such as plain text or Markdown.
- Allow importing multiple notes.
- Preserve original note content.
- Preserve creation dates and source information when reliably supplied.
- Detect or manage duplicate imports.
- Associate imported notes with their authenticated owner.
- Make imported notes available to search and contextual enrichment.
- Provide clear results for successful, skipped, or failed imports.

**Acceptance criteria:** A supported collection of existing notes can be imported without losing original content, creating unauthorized access, or unnecessarily duplicating records.

**Priority qualification:** This requirement is recommended because several scenarios involve long note histories stored in other applications. It is an inferred product need rather than an explicit request for a particular import format. It can be moved earlier if testing with real historical collections becomes a priority.

---

## 4. Phase 2B — Patterns, Reflection, and Personal Insight

**Priority: P1 — High**

**Goal:** Help users recognize recurring ideas, understand patterns, and reflect on how their thinking has developed.

This phase is built on the relationship and retrieval capabilities established in Phase 2A.

### FR-19 — Recurring Theme Discovery

**Requirement:** Twinkle shall identify and organize meaningful recurring themes across a user's collection of notes.

**Functional capabilities:**

- Identify repeated topics and themes using existing context.
- Group relevant notes under understandable theme labels.
- Show how frequently a theme appears.
- Allow users to examine the notes contributing to a theme.
- Support theme exploration across defined time periods.
- Recalculate summaries when notes are edited or deleted.
- Avoid overclaiming patterns from insufficient data.

**Example:** "You have written about creative confidence in 8 notes over the past three months."

**Acceptance criteria:** Displayed theme counts accurately reflect the underlying eligible notes. Users can inspect the evidence supporting each theme. Percentages, when displayed, must be calculated from actual data rather than invented by an AI model.

### FR-20 — Thematic Note Clustering

**Requirement:** Twinkle shall organize conceptually related notes into discoverable groups.

**Functional capabilities:**

- Identify groups of notes that share recurring ideas or themes.
- Allow users to explore the notes in each group.
- Support notes belonging to multiple relevant groups.
- Update generated groups when the collection changes.
- Distinguish automatically suggested groupings from user-confirmed collections.
- Allow users to dismiss or correct unhelpful groupings.

**Acceptance criteria:** Related ideas captured independently can be discovered as a group. Every generated group links to its supporting notes, and changes to the collection do not leave invalid references.

**Note:** Visual cluster maps are not required at this stage.

### FR-21 — Longitudinal Reflection and Thinking Evolution

**Requirement:** Twinkle shall help users compare their past and present reflections on related subjects.

**Functional capabilities:**

- Identify related notes recorded at different times.
- Present relevant historical context and dates.
- Highlight changes, continuities, or unresolved questions supported by the notes.
- Support user-initiated comparisons about topics or ideas.
- Show the original notes used to construct any comparison.
- Avoid claiming changes in personal beliefs or emotional states without sufficient evidence.

**Example:** A user can compare reflections about self-confidence from two different periods and see how their descriptions or concerns have changed.

**Acceptance criteria:** Comparisons are grounded in multiple real notes with clear dates and references. The system explicitly handles insufficient or contradictory evidence.

### FR-22 — Interactive Reflective Prompts

**Requirement:** Users shall be able to respond to reflective questions about previous notes and preserve their responses.

**Functional capabilities:**

- Offer optional, contextually relevant reflective questions about past notes.
- Reuse existing flashbacks where appropriate.
- Allow users to respond, skip, or dismiss a question.
- Save responses as new reflections linked to the originating note.
- Preserve the original historical note.
- Make subsequent reflections available for future comparisons.
- Avoid repeatedly asking the same question.

**Example:** "You wrote this about discipline last year. Do you still agree with it?"

**Acceptance criteria:** A user can respond to a past-note question, save the response, and revisit both the original note and subsequent reflection independently.

This extends FR-09's contextual prompting and FR-10's flashbacks rather than replacing them.

### FR-23 — Periodic Personal Insight Recaps

**Requirement:** Twinkle shall be able to provide concise, optional summaries of meaningful activity and patterns within a user's note collection.

**Functional capabilities:**

- Generate weekly or other user-selected periodic recaps.
- Summarize themes, captured insights, and notable connections supported by notes.
- Reference original notes when presenting insights.
- Include relevant rediscovery opportunities.
- Allow users to enable or disable recurring recaps.
- Support in-app access independently of push notification delivery.
- Avoid generating recaps when there is insufficient meaningful activity.

**Acceptance criteria:** A recap accurately summarizes its stated time period, links to supporting notes, respects user preferences, and does not fabricate insights or activity.

---

## 5. Phase 2C — Creative Development and Knowledge Application

**Priority: P2 — Medium**

**Goal:** Help users turn captured thoughts into increasingly developed ideas and useful creative outputs.

### FR-24 — Idea Development Stages

**Requirement:** Users shall be able to optionally identify and manage the developmental stage of an idea.

**Functional capabilities:**

- Support simple stages such as:
  - Seed / Raw Idea
  - Developing
  - Ready
  - In Progress
  - Completed
- Allow users to assign or change a stage.
- Filter or retrieve ideas by stage.
- Preserve associated notes and context as stages change.
- Keep stage management optional rather than mandatory for all notes.

**Acceptance criteria:** A user can mark an idea's stage and retrieve ideas at that stage without changing the note's original content or requiring additional categorization for ordinary notes.

### FR-25 — Create From Existing Notes

**Requirement:** Users shall be able to use one or more saved notes as source material for new drafts or structured creative outputs.

**Functional capabilities:**

- Select multiple notes for a creative task.
- Generate optional outlines or draft structures using the selected material.
- Support practical output formats such as essay outlines, content outlines, or structured idea summaries.
- Preserve references to originating notes.
- Allow users to edit generated material.
- Save created work without overwriting source notes.
- Never publish or share generated material automatically.

**Example:** A user selects several notes about creative resistance and asks Twinkle to help structure them into a potential essay outline.

**Acceptance criteria:** The generated material is traceable to selected notes, editable, and stored separately from original source content.

### FR-26 — Creative Opportunity Suggestions

**Requirement:** Twinkle shall be able to identify collections of related notes that may contain the foundation for a new creative project.

**Functional capabilities:**

- Identify recurring observations that could be developed together.
- Suggest potential essays, stories, articles, or content concepts when sufficient related material exists.
- Explain the connection between the selected notes.
- Allow users to review supporting material.
- Provide an option to begin developing a suggested idea using FR-25.
- Allow users to dismiss suggestions.
- Avoid making repetitive or low-quality suggestions.

**Example:** "You've explored loneliness from several different perspectives. These notes could become the foundation of an essay."

**Acceptance criteria:** Suggested opportunities reference real, sufficiently related notes. Users can accept, ignore, or dismiss the suggestion without affecting their original collection.

---

## 6. Phase 2D — Advanced Experiences and Integrations

**Priority: P3 — Deferred**

These requirements remain part of the product vision but should not delay the more foundational capabilities.

### FR-27 — Visual and Sketchbook-Style Exploration

**Requirement:** Twinkle shall eventually support alternative ways to explore captured material beyond a conventional text list.

**Future capabilities:**

- Visually explore related notes and creative themes.
- Support richer presentation of photographs and visual references.
- Present note clusters in a creative, browsable format.
- Preserve access to original text and source content.

**Acceptance criteria:** Users can explore creative notes through a visual representation while retaining access to the original notes and their relationships.

Detailed interaction and visual design requirements are deferred to the UI/UX phase.

### FR-28 — Contextual Mood and Memory Cues

**Requirement:** Twinkle shall be able to help users reconnect with the context surrounding an earlier note without inventing emotional experiences.

**Future capabilities:**

- Preserve explicitly stated emotions or user-provided contextual descriptions.
- Display relevant historical details, related notes, and time-based context.
- Support optional user-confirmed mood or memory cues.
- Avoid reconstructing unsupported emotional states from writing style alone.
- Provide control over whether sensitive context can be resurfaced.

**Acceptance criteria:** A reopened historical note can display meaningful, evidence-based contextual cues while respecting sensitivity settings and distinguishing recorded facts from AI interpretations.

### FR-29 — Calendar-Aware Task Assistance

**Requirement:** Twinkle may support scheduling assistance for notes containing actionable tasks through an optionally connected calendar.

**Future capabilities:**

- Identify actionable tasks from note content.
- Let users confirm or correct extracted task details.
- Connect supported calendar accounts with explicit permission.
- Retrieve relevant availability information.
- Suggest suitable times for user-confirmed tasks.
- Allow users to approve any new calendar event.
- Avoid modifying calendars without confirmation.
- Handle calendar permissions, conflicts, and time zones.

**Acceptance criteria:** A user can review a task identified from a note, see suggested scheduling options based on authorized calendar availability, and explicitly approve an event.

### FR-30 — External Knowledge and Capture Integrations

**Requirement:** Twinkle may support importing and associating information from supported external reading, note-taking, or reference sources.

**Future capabilities:**

- Connect selected external services with user authorization.
- Import supported notes, highlights, or references.
- Preserve attribution and available source metadata.
- Avoid unnecessary duplicates.
- Respect provider restrictions and user permissions.
- Allow users to disconnect external services.

**Acceptance criteria:** A user can authorize a supported integration and import eligible material while retaining appropriate source attribution and control over the connection.

This extends the simpler file-based importing in FR-18.

---

## 7. Cross-Requirement Engineering Standards

These standards apply throughout Phase 2.

### A. Accuracy and Traceability

- AI-generated connections, summaries, and interpretations must be grounded in actual notes.
- Collection-level insights must reference their supporting notes.
- Generated statements must distinguish observations from interpretations.
- Numerical counts, percentages, and dates must come from verified application data.
- Unsupported conclusions should be omitted or clearly qualified.

### B. Privacy and User Ownership

- Preserve Supabase authentication and user-specific access controls.
- Enforce Row Level Security on new user-owned records.
- Do not expose private note contents or AI-derived information to other users.
- Respect existing enrichment, flashback, and notification preferences.
- Treat inferred emotions, personal experiences, and sensitive topics conservatively.
- Never make external calendar or account changes without authorization.

### C. Data Consistency

- Keep the existing unified note structure.
- Maintain links between derived information and original notes.
- Prevent stale AI results from overwriting newer information.
- Update or invalidate derived relationships after relevant note changes.
- Ensure deleted notes do not continue appearing in search, clusters, insights, or recommendations.
- Preserve user edits and confirmations independently of regenerated AI content.

### D. Performance and Cost

- Reuse contextual metadata generated in Phase 1.
- Prefer indexed PostgreSQL search and efficient database queries.
- Avoid sending an entire user's note collection to an AI model for every search.
- Use bounded retrieval and relevance filtering before AI processing.
- Cache or persist derived information when appropriate.
- Consider pgvector within Supabase if evaluations demonstrate a meaningful need for semantic similarity; do not introduce a separate vector database by default.
- Test retrieval performance with realistically sized collections.

### E. Product Experience

- Preserve fast, low-friction note capture.
- Make intelligent suggestions optional.
- Avoid excessive prompts, alerts, or proactive interventions.
- Keep generated suggestions dismissible.
- Support useful experiences even when AI processing fails.
- Allow users to access and manage their original notes independently of advanced intelligence features.

---

## 8. Recommended Implementation Order

The requirements should be implemented in small, testable groups rather than simultaneously.

| Order | Requirements | Intended outcome |
|---|---|---|
| 1 | FR-13 | Users can quickly find previously captured information |
| 2 | FR-14 + FR-15 | Notes retain source attribution and meaningful connections |
| 3 | FR-16 + FR-17 | Existing knowledge becomes useful during capture and intentional rediscovery |
| 4 | FR-18 | Users can expand their collection with historical notes; move earlier if needed for testing |
| 5 | FR-19 + FR-20 | Twinkle recognizes recurring themes and related groups |
| 6 | FR-21 + FR-22 | Users can compare and reflect on how their thinking develops |
| 7 | FR-23 | Recurring insight summaries support ongoing engagement |
| 8 | FR-24 + FR-25 | Users can develop ideas and create from their notes |
| 9 | FR-26 | Twinkle proactively identifies creative opportunities |
| Later | FR-27 through FR-30 | Advanced exploration and external integrations |

Each group should be implemented, tested, and validated before dependent functionality is introduced.

## 9. Scenario-Based Acceptance Tests

The following tests should be used to evaluate whether the completed requirements solve the actual problems identified in the Scenario Spec.

| Persona | Scenario | Expected behavior |
|---|---|---|
| Maya | Creates a note about celestial artwork after writing several older notes about stars and dreams | Twinkle identifies relevant older ideas without requiring manual browsing |
| Daniel | Saves related insights about discipline from two different books | Twinkle connects the notes while retaining their distinct sources |
| Lila | Captures recurring reflections about confidence across different years | Twinkle identifies the recurring theme and supports reviewing changes over time |
| Alina | Has hundreds or thousands of short creative fragments | Twinkle supports reliable retrieval, relevant grouping, and discovery without overwhelming browsing |
| Naomi | Revisits reflections from different periods of her life | Twinkle provides grounded historical context and optional reflection without inventing emotional interpretations |
| Creative user | Selects several related observations for an essay | Twinkle helps organize them into an editable outline while preserving the source notes |

These scenarios should form the basis of repeatable functional evaluation. Testing should include relevant matches, irrelevant matches, sparse collections, duplicate notes, deleted notes, and sensitive content.

## 10. Phase 2 Completion Criteria

Phase 2 should not be considered complete merely because the new functions can be called successfully.

The implementation should demonstrate that users can:

1. Retrieve forgotten notes efficiently.
2. Discover meaningful relationships between independently captured ideas.
3. See recurring patterns supported by their own notes.
4. Compare older and newer reflections without fabricated conclusions.
5. Turn saved material into useful new outputs when they choose.
6. Continue capturing notes as easily as before.

Advanced visual experiences and external integrations are not required before evaluating the success of the foundational intelligence features.

## 11. Implementation Guidance for Codex

This specification defines the approved *direction and proposed functional scope*, not authorization to implement every requirement immediately.

When implementing a requirement or group of requirements:

- Read this specification and the existing Twinkle technical reference.
- Inspect the implemented Phase 1 functionality before making changes.
- Reuse existing infrastructure when appropriate.
- Implement only explicitly assigned requirements.
- Verify behavior against the corresponding acceptance criteria.
- Preserve existing functionality and data.
- Report changes, tests, limitations, and necessary configuration.
- Stop after the assigned requirements are complete.

**Primary Phase 2 objective:** Transform Twinkle from an intelligent note repository into a personal knowledge companion that helps users rediscover, connect, understand, and build upon their own thoughts.