# Twinkle V1 — Product & Technical Reference

**Project:** Twinkle<br>
**Current codebase:** `Twinkle_V1`<br>
**Platform:** Android first, iOS compatibility maintained<br>
**Status:** Initial development

## 1. Product Overview

Twinkle is an AI-powered mobile note-taking application designed for casual note-takers.

Its purpose is to help people effortlessly capture their thoughts, preserve meaningful context, and rediscover important notes at relevant moments.

Twinkle is built around three core pillars:

1. **Capture:** Make it effortless to create notes through typing, photographs, or audio recordings.
2. **Retention:** Preserve meaningful context around notes through intelligent, unobtrusive AI enrichment and relevant metadata.
3. **Recall:** Help users rediscover meaningful notes through personalized, contextually relevant flashbacks.

The product should prioritize simplicity, speed, minimal user effort, and a distraction-free experience.

## 2. Agreed Technology Stack

The following is the default technology stack for Twinkle V1.

| Component | Technology | Purpose |
|---|---|---|
| Mobile framework | React Native + Expo | Cross-platform mobile development |
| Programming language | TypeScript | Primary application and backend function language |
| Backend platform | Supabase | Managed backend infrastructure |
| Database | Supabase PostgreSQL | User data, notes, metadata, and flashbacks |
| Authentication | Supabase Auth | User registration, login, and sessions |
| Media storage | Supabase Storage | Images and audio files |
| Server-side logic | Supabase Edge Functions | Secure AI processing and backend operations |
| AI integration | OpenAI API | Note understanding, enrichment, and content processing |
| Speech transcription | OpenAI speech-to-text API | Convert recorded audio into text |
| Image processing | Vision-capable AI model | Extract text from images and photographs |
| Notifications | Expo Notifications | Flashback delivery |
| Scheduled operations | Supabase Cron | Trigger future flashback processing |

### Architectural Principles

- Maintain a single React Native codebase supporting both Android and iOS.
- Use Expo's managed tooling and supported native modules where practical.
- Use Supabase as the primary backend. Do not introduce a separate Node.js, Express, or Python backend unless a clear requirement emerges.
- Use TypeScript consistently.
- Keep the architecture modular but simple.
- Avoid unnecessary dependencies, services, and abstractions.
- Keep AI integrations replaceable so specific models can be changed without major application rewrites.
- Prioritize maintainability and practical implementation over premature optimization.

## 3. Core Functional Requirements

The following requirements define Twinkle's intended core functionality. They are not instructions to implement every feature immediately.

| ID | Functional Requirement | Description | Scope |
|---|---|---|---|
| FR-01 | User authentication | Users can register, log in, log out, and maintain authenticated sessions using Supabase Auth. | Initial foundation |
| FR-02 | Text note creation | Users can create and save notes through a simple text editor. | Initial foundation |
| FR-03 | Note management | Users can view, edit, and delete their notes. | Initial foundation |
| FR-04 | Cloud persistence | Notes are stored in Supabase and associated securely with their owners. | Initial foundation |
| FR-05 | Photo-to-note | Users can take or select photographs and extract text into editable notes using AI. | Core capability |
| FR-06 | Audio-to-note | Users can record audio and convert speech into editable text notes. | Core capability |
| FR-07 | Contextual enrichment | AI can identify relevant topics, themes, and contextual cues from notes without altering the original content. | Core capability |
| FR-08 | Context metadata | Store relevant timestamps, capture methods, and useful contextual information alongside notes. | Core capability |
| FR-09 | Minimal contextual prompting | The application may offer brief, optional contextual prompts when genuinely useful, without interrupting note capture unnecessarily. | Core capability |
| FR-10 | Note flashbacks | Previously saved notes can be resurfaced based on meaningful contextual relevance. | Core capability |
| FR-11 | Flashback notifications | Users can receive occasional personalized notifications referencing real saved notes. | Core capability |
| FR-12 | Notification preferences | Users can control flashback notifications, including their frequency and whether notifications are enabled. | Core capability |

## 4. Core Data and AI Design Guidelines

### Unified Note Structure

Regardless of capture method, all successfully processed notes should use a common note structure.

Each note should support:

- A unique note identifier
- User ownership
- Original note content
- Capture method (text, image, or audio)
- Creation and modification timestamps
- Optional contextual metadata
- Optional references to original media

The database structure should allow future expansion without unnecessarily complex schemas.

### AI Processing

AI should enhance the note-taking experience rather than become a requirement for basic note creation.

- Preserve original user content.
- Keep AI-generated context distinguishable from user-provided information.
- Perform AI processing securely through server-side functions.
- Do not block basic note saving while waiting for AI processing.
- Allow users to review or edit generated note content.
- Handle AI errors gracefully without losing captured information.
- Avoid unnecessary model calls and associated costs.

### Flashback Design

Flashbacks must reference actual notes belonging to the user.

The system should consider note content, recorded context, note age, and potential relevance when choosing notes to resurface.

AI may help formulate personalized flashback messages, but must not fabricate user experiences or events.

Advanced recommendation algorithms, semantic embeddings, and vector search are optional future enhancements, not initial requirements.

## 5. Security and Privacy

Twinkle may store personal thoughts and sensitive information. Privacy must be considered from the beginning.

- Enforce user-specific access through Supabase Row Level Security (RLS).
- Use private media storage and appropriate storage access policies.
- Never expose privileged Supabase keys or AI API secrets in mobile application code.
- Request device permissions only when the relevant functionality requires them.
- Treat location and other sensitive contextual metadata as optional and permission-based.
- Ensure users cannot access another user's private notes.

## 6. Current Development Context

An Expo project named `Twinkle_V1` has already been initialized and successfully tested using Expo's development server.

**Do not recreate or replace the existing Expo project.**

Supabase integration has not yet been configured.

The immediate development focus is to establish the core application foundation within the existing project:

- Integrate Supabase with the Expo application.
- Establish user authentication and secure note ownership.
- Implement basic text-based note creation, storage, retrieval, editing, and deletion.
- Keep the interface minimal, responsive, and suitable for casual note-taking.

The existing project configuration should be inspected before adding dependencies or changing its structure.

## 7. Instructions for Codex

Use this document as the technical and functional reference for the Twinkle project.

It establishes the agreed stack, architectural direction, and core product capabilities. It is **not authorization to build every listed feature immediately**.

Follow these working principles:

1. Work incrementally within the existing `Twinkle_V1` codebase.
2. Implement only the features explicitly requested in subsequent instructions.
3. Prefer the simplest reliable implementation that meets the requirement.
4. Avoid unnecessary libraries, architectural layers, or infrastructure.
5. Use established security practices, especially for authentication and database access.
6. Maintain compatibility with a future iOS release while focusing initial development and testing on Android.
7. Keep code readable, organized, and easy to extend.
8. Explain significant technical decisions or changes to the agreed stack before introducing them.
9. Verify implemented functionality and report any limitations or configuration requirements.
10. Preserve the three product pillars—Capture, Retention, and Recall—as the guiding direction for development.

**Primary objective:** Establish a reliable, minimal foundation for Twinkle, then progressively introduce its AI-powered capture, contextual retention, and intelligent recall capabilities as further requirements are provided.

Future scenario specifications and refined functional requirements will provide additional product detail and should be incorporated incrementally without unnecessarily restructuring working functionality.