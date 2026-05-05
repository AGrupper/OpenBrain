# OpenBrain Master Plan: PARA Vault + Graph-First Architect Wiki

This is the durable implementation plan for OpenBrain. Use this file with
`docs/SESSION_CONTEXT.md` at the start of every work session.

## How To Use This Plan

- Start each session by reading this file, `SESSION_CONTEXT.md`, and `git status`.
- Continue from the highest-priority unfinished milestone.
- If a blocker appears, add a concrete substep before acting.
- Update this plan when scope changes.
- Update `SESSION_CONTEXT.md` after each meaningful session with what changed, what passed, what
  failed, and the next exact step.
- Do not touch secrets, auth logic, database migrations, payments, deployment config, or destructive
  data flows without explicit warning and approval.

## Product Shape

OpenBrain has two complementary layers:

- **Raw Vault:** user-owned files, notes, URLs, transcripts, and media organized with PARA:
  `Projects`, `Areas`, `Resources`, and `Archive`.
- **Architect Wiki / Knowledge Graph:** AI-maintained knowledge layer of topics, claims, people,
  projects, concepts, contradictions, and synthesis pages derived from the raw vault.

The raw vault answers: "What did I save?"

The graph wiki answers: "What does OpenBrain understand?"

## Product Decisions

- PARA is the default organization method for raw files and notes:
  - `Projects`: active outcomes with deadlines or clear completion.
  - `Areas`: ongoing responsibilities and standards.
  - `Resources`: reference material by topic.
  - `Archive`: inactive projects, old areas, and no-longer-current resources.
- The Architect may suggest PARA placement, but raw files and user-authored notes must not be
  silently moved.
- Generated wiki pages are Architect-owned, not raw user notes.
- The Graph view evolves into the main Architect Wiki surface.
- Clicking a graph node opens a generated page with citations, backlinks, related nodes, and
  history.
- Wiki updates use hybrid trust:
  - Start with review-required diffs.
  - Later allow automatic low-risk wiki updates only after audit history and rollback exist.
- List view remains the raw-material explorer.

## Milestone Status

| Milestone                             | Status      | Acceptance                                                                                                        |
| ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| 0. Baseline And Master Plan           | Complete    | Master plan exists, session context is current, formatting gate is fixed, and baseline checks pass.               |
| 1. Prove Existing Vault Loop          | Complete    | Import -> process -> review -> approve -> reader/graph works locally.                                             |
| 2. PARA Raw Vault                     | Complete    | Files and notes can be browsed by PARA, and Architect suggestions can place items into PARA without silent moves. |
| 3. Markdown Note Workspace            | Complete    | Markdown notes can be created, edited, saved, searched, renamed, and deleted.                                     |
| 4. Graph-First Architect Wiki         | In progress | Imported sources can produce visible knowledge nodes and readable generated pages.                                |
| 5. Broad Ingestion: Files And URLs    | Pending     | Supported files and URLs become searchable vault items with clear processing state.                               |
| 6. Embeddings And Media Understanding | Pending     | Search/chat can retrieve from raw files, media chunks, transcripts, and wiki pages.                               |
| 7. Architect Recommendations          | Pending     | The Architect proactively recommends while user-owned material remains controlled.                                |
| 8. Real Login                         | Pending     | Real login works and users cannot access each other's vault data.                                                 |
| 9. Search, Chat, And Reader Quality   | Pending     | OpenBrain answers from the vault and shows where answers came from.                                               |
| 10. Export, Delete, And Privacy       | Pending     | Full portable export and safe deletion work.                                                                      |
| 11. Cross-Platform Desktop            | Pending     | App can be built and run on PC and Mac from documented steps.                                                     |

## Milestone Details

### 0. Baseline And Master Plan

- Done: created this file.
- Done: updated `SESSION_CONTEXT.md`.
- Done: fixed current formatting failures.
- Done: re-ran:
  - `npm.cmd test`
  - `npm.cmd run typecheck`
  - `npm.cmd run lint`
  - `npm.cmd run format:check`
  - `cargo fmt --all -- --check`
  - `cargo clippy --all-targets --all-features -- -D warnings`
  - `cargo test --all-features`

### 1. Prove Existing Vault Loop

- Run local Worker/Desktop.
- Use deterministic Architect smoke mode.
- Approve/reject folder, tag, and link suggestions.
- Confirm approved links appear in reader and graph.
- Done: local screenshots confirmed the reader opens vault files, Graph renders smoke vault nodes,
  and inline PARA folder/note creation works.
- Done: Graph links now render with enough contrast to inspect approved relationships, and clicking
  a graph node opens an inspectable detail panel with connected files and an explicit reader action.
- Fix only bugs found in this loop.

### 2. PARA Raw Vault

- Done: add first-class PARA roots: `Projects`, `Areas`, `Resources`, `Archive`.
- Done: update folder creation/import defaults so new material lives under PARA roots by default.
- Done: add Architect suggestions for PARA placement.
- Done: add review UI copy that explains why a file belongs in a PARA category.
- Done: replace prompt-based folder/note creation with inline controls.
- Done: manually smoked the Review Inbox loop with deterministic Architect suggestions:
  `openbrain-smoke-related-fresh.md` moved into `Resources/smoke/related` only after approval, and
  approved tags appeared on the file.
- Keep "All files" available as a neutral view.

### 3. Markdown Note Workspace

- Replace prompt dialogs with compact in-app controls.
- Done: replace prompt dialogs with compact in-app controls for folder/note creation.
- Done: add Markdown edit/save/cancel flow in the reader.
- Done: update R2 file content, hash, size, text content, and reprocessing flags on save.
- Done: create a pending Architect job after Markdown saves.
- Done: handle unsaved changes for in-list navigation and save errors.
- Done: manually smoked edit -> save -> reload -> search with a unique phrase in the running app.

### 4. Graph-First Architect Wiki

- Started safely without schema changes: raw source nodes now have a graph detail panel that shows
  path, PARA folder, tags, summary when present, approved connected files, reasons, and confidence.
- Next schema-backed step requires explicit migration approval before storing generated wiki pages,
  wiki node types, citations, backlinks, or update history.
- Add generated wiki node types: `Source`, `Topic`, `Person`, `Project`, `Area`, `Resource`,
  `Claim`, `Question`, `Synthesis`, and `Contradiction`.
- Add edge types: `derived_from`, `supports`, `contradicts`, `mentions`, `summarizes`,
  `related_to`, `part_of`, and `answers`.
- Store generated wiki pages separately from raw user files.
- Add graph node detail panel with generated Markdown, citations, backlinks, and update history.
- Add Review Inbox items for proposed wiki changes.

### 5. Broad Ingestion: Files And URLs

- Accept local files and arbitrary allowed URLs.
- Store metadata, extracted text/transcripts, summaries, and processing status.
- Support webpages, PDFs, images, audio, video, and YouTube where extraction is allowed.
- Do not bypass paywalls, DRM, private content, or login restrictions.
- Queue processing automatically after import.

### 6. Embeddings And Media Understanding

- Use `gemini-embedding-2` as the canonical embedding model.
- Migrate embeddings to the final chosen dimension before large-scale use.
- Store chunks for long documents, media, transcripts, and generated wiki pages.
- Keep deterministic smoke mode aligned with production embedding shape.

### 7. Architect Recommendations

- Expand Review Inbox into the recommendation center.
- Support suggestions for PARA placement, tags, summaries, links, claims, wiki updates,
  contradictions, and actions.
- Add audit history for accepted/rejected recommendations.
- Add rollback before allowing any automatic wiki updates.

### 8. Real Login

Warning: this milestone touches auth logic and database ownership. Stop for explicit approval before
editing implementation files for this milestone.

- Use Supabase Auth.
- Desktop signs in and sends user JWT to Worker.
- Worker verifies JWT and scopes data by user.
- Add ownership fields and access-isolation tests.
- Remove normal app dependence on shared bearer token.

### 9. Search, Chat, And Reader Quality

- Search across raw files, PARA folders, metadata, chunks, and wiki pages.
- Chat retrieves from both raw sources and compiled wiki pages.
- Answers cite sources and refuse unsupported claims.
- Reader shows related raw files and related wiki nodes.

### 10. Export, Delete, And Privacy

- Export originals, notes, URLs, metadata, PARA structure, chunks, transcripts, summaries, wiki
  pages, graph edges, and review history.
- Verify delete removes related objects, metadata, embeddings, chunks, suggestions, and graph/wiki
  references.
- Review logs and provider payloads for privacy leaks.

### 11. Cross-Platform Desktop

- Support Windows and macOS desktop.
- Document setup for both.
- Keep iOS as future research, not part of completion.
- Add build checks for desktop frontend and Tauri backend.

## Test Plan

- Unit tests for PARA path validation, placement suggestions, wiki graph types, and review
  decisions.
- Worker route tests for new ingestion, wiki, graph, and auth APIs.
- Deterministic Architect smoke tests for PARA placement and wiki graph generation.
- Manual smoke:
  - Login.
  - Import files.
  - Add URL/YouTube.
  - Create Markdown note.
  - Approve PARA placement.
  - Generate wiki graph nodes.
  - Open graph node page.
  - Ask chat question with citations.
  - Export vault.
