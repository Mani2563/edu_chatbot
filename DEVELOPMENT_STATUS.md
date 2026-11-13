# GapFinder AI — Development Status

## Project Overview
- **Name:** GapFinder AI
- **Tagline:** Find What the Student Doesn't Know
- **Core Philosophy:** Proactive assessment system that tests students, identifies knowledge gaps (Weak, Medium, Strong), and generates a personalized revision plan with verified source citations.
- **Frontend Stack:** HTML5, CSS3, Vanilla JavaScript, Supabase Browser SDK via CDN. (Strictly No React, No Next.js, No TypeScript on frontend).
- **Backend Stack:** Node.js, Vercel Serverless Functions (`api/`), Vercel AI SDK (`ai`, `@ai-sdk/groq`), Groq API, Supabase Database & Auth, Zod, pdf-parse, mammoth.

---

## Phase Breakdown & Progress

| Phase | Description | Status |
|---|---|---|
| **Phase 1** | Project Foundation & Health Check | 🟢 Completed & Tested |
| **Phase 2** | Document Upload, Multi-Format Processing & Supabase Storage Integration | 🟢 Completed & Tested |
| **Phase 3** | RAG Implementation (Deterministic BM25 Chunk Retrieval & Citations) | 🟢 Completed & Tested |
| **Phase 4** | Topic Mapping & Syllabus Extraction | 🟢 Completed, Tested & Hardened |
| **Phase 5** | Diagnostic Quiz Generation (Grounded with Citations & Key Segregation) | 🟢 Completed, Tested & Verified |
| **Phase 6** | Intelligent Gap Analysis Engine (Topic-Level Diagnosis & Safeguards) | 🟢 Completed, Tested & Verified |
| **Phase 7** | Minimum Working Revision Plan (Day-wise Prioritized Schedule & Retesting) | 🟢 Completed, Tested & Verified |
| **Phase 8** | Personalized Revision Plan (Priority × Available Study Hours) | ⚪ Pending |
| **Phase 9** | Explain This Topic Assistant (RAG Chat with Citations) | ⚪ Pending |
| **Phase 10** | Supabase Database Schema & RLS | ⚪ Pending |
| **Phase 11** | Progress Dashboard & Multi-Attempt Tracking | ⚪ Pending |
| **Phase 12** | Security, Error Handling & Secret Protection | ⚪ Pending |
| **Phase 13** | End-to-End Verification & Testing | ⚪ Pending |
| **Phase 14** | Vercel Deployment & GitHub Documentation | ⚪ Pending |

---

## Implemented API Endpoints
- `GET /api/health` — Returns `{ "success": true, "message": "GapFinder AI backend is running", "services": { ... } }`.
- `GET /api/config` — Returns public `{ supabaseUrl, supabaseAnonKey }`.
- `POST /api/auth/signin` — Authenticates user with Supabase Auth, returns JWT session.
- `POST /api/auth/signup` — Registers student with Supabase Auth.
- `GET /api/auth/session` — Validates Bearer JWT via Supabase Auth and returns user profile.
- `POST /api/documents/process` — Idempotent text extraction and chunk indexing from private Supabase Storage.
- `GET /api/documents/list` — Lists authenticated student's uploaded documents (respects RLS, omits heavy content).
- `POST /api/quiz/generate` — Generates grounded diagnostic multiple-choice questions for targeted topic/chapter with 4-stage citation verification. Strips answers and explanations upfront.
- `POST /api/quiz/submit` — Evaluates student answers, calculates score and percentage, persists attempt in database, and returns grounded review with citations and explanations.
- `GET /api/quiz/history` — Returns past completed quiz attempts for authenticated student.
- `DELETE /api/documents/delete?id=<doc_id>` — Safely deletes document record and corresponding Storage object.
- `POST /api/rag/retrieve` — Deterministic Okapi BM25 retrieval over student's indexed study chunks with source citations.
- `POST /api/topics/extract` — Extracts grounded hierarchical topic map from selected syllabus document.
- `GET /api/topics/list` — Lists student's extracted subjects and curricula.
- `GET /api/topics/detail?id=<subject_id>` — Returns subject and nested topic hierarchy with source citations.
- `PATCH /api/topics/update` — Updates review status (`draft` → `reviewed` → `approved`) or renames topics.
- `DELETE /api/topics/delete?id=<topic_id>` — Deletes topic with database cascading delete to subtopics.

## Database Migrations Applied & Verified Live
- `database/001_document_chunks.sql`: Table `public.document_chunks` verified live in Supabase.
- `database/002_subjects_and_topics.sql`: Tables `public.subjects` and `public.topics` verified live in Supabase with composite foreign key integrity `(parent_topic_id, subject_id, user_id) -> (id, subject_id, user_id)`.
- `database/003_topic_tree_rpc.sql`: Transactional RPC function `public.save_topic_tree` verified live in Supabase PostgreSQL; confirmed native database WAL rollback and atomic single-transaction topic hierarchy persistence. Updated to protect both `reviewed` and `approved` subjects.
- `database/004_preserve_student_topic_edits.sql`: Enhanced RPC function `public.save_topic_tree` (Version 2) with `p_confirm_discard_edits BOOLEAN DEFAULT FALSE`. Protects both `reviewed` and `approved` topic maps, computes in-database `v_existing_edited_count > v_payload_edited_count`, and raises an exception if customized topics would be lost without explicit confirmation.
- All tables verified with RLS enabled and 16 user-isolation policies (`auth.uid() = user_id`).

## Implemented Architecture & Modules
- **Chunker & Parser:** `lib/chunking.js` & `lib/document-parser.js`.
- **Retrieval:** `lib/retriever.js` (Okapi BM25 engine).
- **Topic Mapping:** `services/topic-service.js` (Groq LLM extraction + deterministic structural outline parser, SHA-256 fingerprinting for duplicate prevention, in-flight extraction deduplication, conflict recovery on PostgreSQL 23505, atomic RPC persistence with fallback).
- **Models:** `models/document-model.js`, `models/document-chunk-model.js`, `models/topic-model.js` (added `saveTopicTreeViaRpc`).
- **Controllers:** `controllers/document-controller.js`, `controllers/rag-controller.js`, `controllers/topic-controller.js` (added `409 Conflict` handling for incomplete concurrent races).
- **Frontend UI:** `public/app.js` & `public/index.html` (Syllabus selection dropdown, interactive expandable/collapsible hierarchy tree, draft/approved review lifecycle, inline topic renaming and deletion).

## Test Verification Summary
- **Live Supabase PostgreSQL Verification (Phases 1–4):** Passed 100%.
  - Verified remote tables exist: `documents`, `document_chunks`, `subjects`, `topics`.
  - Verified document chunk persistence in Supabase PostgreSQL across local application restart.
  - Verified BM25 RAG retrieval queries persisted Supabase chunks (`score: 1.4384`, `score: 0.9863`).
  - Verified topic extraction persists subject record and full 4-tier topic tree (14 nodes) in Supabase.
  - Verified composite parent foreign key (`fk_topics_parent`) strictly blocks cross-subject and cross-user parent linking (`PostgreSQL code: 23503`).
  - Verified approved topic map preservation: re-extraction rejected with HTTP 400 when status is `approved`.
  - Verified student topic edits: rename persisted in `public.topics` (`studentEdited: true`) and reflected in nested tree API.
  - Regressions verified: Phase 1 (Health 200), Phase 2 (Upload/Process 200), Phase 3 (RAG 200), Phase 4 (Topics 200). Unauthenticated requests return HTTP 401 across all endpoints.

## Phase 4 Final Hardening & Concurrency Verification
- **Simultaneous Extraction Race Test:**
  - Two simultaneous extraction requests fired via `Promise.all`: Request 1 returned HTTP 200 (8 nodes); Request 2 returned HTTP 200 (`concurrentResolved: true`).
  - Supabase database verified: exactly 1 subject and 1 topic tree (8 rows) created with zero duplicates.
- **Identical Repeated Extraction:**
  - Repeated call on existing syllabus document returns HTTP 200 with `idempotent: true` and preserves existing database records without extra rows.
- **Mid-Tree Failure & Rollback Test:**
  - Simulated mid-tree failure (CHECK constraint violation on `hierarchy_level`).
  - Application-level rollback (`deleteSubject`) executed: verified Supabase database has exactly 0 subjects and 0 topics left behind.
- **Live Transactional PostgreSQL RPC Verification:**
  - Migration `database/003_topic_tree_rpc.sql` (`public.save_topic_tree`) verified live in Supabase PostgreSQL.
  - Runtime extraction confirmed calling the RPC directly: returned `transactional: true`, `message: 'Topic map extracted and saved atomically via PostgreSQL transaction'`.
  - True database transaction rollback verified empirically: deliberate mid-tree check constraint violation aborted the RPC call (`code: 23514`) and PostgreSQL automatically rolled back the entire transaction; direct database query confirmed exactly 0 subjects and 0 topics left behind.
  - Security confirmed: unauthenticated RPC call rejected with `P0001: Unauthorized: Valid authentication required`; cross-user document access rejected with `P0001: Source document not found or access denied`; approved-map overwrite rejected with `P0001: Syllabus already has an approved topic map`.
  - Fallback compensating cleanup path is maintained in application code for complete resilience.

## Phase 4 Final Defect Fix: Student Edit Preservation Verification
- **Protection of Reviewed & Approved Subjects:**
  - Database (`save_topic_tree`) and Service layer (`TopicService._executeExtraction`) guard `status IN ('reviewed', 'approved')`.
  - Re-extraction without `forceReextract=true` returns HTTP 400 with descriptive error (`Syllabus already has a <status> topic map`).
- **Service-Layer Edit Matching & Merging (`_matchStudentEdits`):**
  - Matches previous topics having `studentEdited: true` against newly extracted nodes.
  - Strict constraints: matches only identical `hierarchy_level`, never matches by array position, computes normalized heading score and chunk/section citation score.
  - Disqualifies ambiguous/tied candidates.
  - Preserves custom `name`, `description`, `originalName`, and `studentEdited: true`.
- **Unmatched Custom Edit Detection (HTTP 409 Conflict):**
  - If a student-edited topic's section is deleted from the syllabus and cannot be matched, re-extraction stops upfront with HTTP 409 Conflict and `status: 'unmatched_edits_detected'`.
  - Zero existing topics are deleted in Supabase.
- **Explicit Discard Authorization:**
  - Supplying `confirmDiscardEdits: true` allows the user to authorize discarding custom edits if the syllabus has fundamentally changed.
- **Frontend Interaction (`public/app.js`):**
  - Displays confirmation dialog listing affected student-edited topic names upon receiving HTTP 409 `unmatched_edits_detected`.
- **Empirical Test Suite Execution (`scratch/test_student_edits.mjs`):**
  - Test 1: Reviewed & Approved Protection -> HTTP 400 (Passed).
  - Test 2: Extraction & Topic Edit Persistence -> `studentEdited: true` in Supabase (Passed).
  - Test 3: Idempotent extraction with unchanged fingerprint -> HTTP 200, edit intact (Passed).
  - Test 4: Re-extraction with content change on matching section -> HTTP 200, custom name preserved (Passed).
  - Test 5: Section removed without confirmation -> HTTP 409 Conflict, topics preserved in DB (Passed).
  - Test 6: Re-extraction with `confirmDiscardEdits: true` -> HTTP 200, cleanly replaced (Passed).
  - All Phase 1-4 regressions verified 100% green. Production student data completely intact.

## Phase 4 Remediation: Groq JSON Generation Hardening & Context Selection
- **Root Cause of Groq Failure at Position 6067:**
  - `openai/gpt-oss-120b` generated raw JSON text with markdown fences. A missing comma or unescaped quote near line 170 caused unhandled `JSON.parse` syntax failure.
  - Naive regex fallback then extracted math expressions (`- x`, `- sin`, `- BD`, `- cot 74`) as subtopics.
  - Context selection was hardcoded to `chunks.slice(0, 25)` (pages 1-7), cutting off before the Table of Contents on page 9 (chunk 32).
- **Schema-Constrained Generation (`Output.object`):**
  - Replaced manual JSON text parsing and regex extraction with Vercel AI SDK's `Output.object({ schema: StrictCurriculumSchema })`.
  - Configured strict Zod schema with required fields to conform with Groq's JSON Schema API specifications.
- **Intelligent Representative Context Selection:**
  - Implemented `_selectRepresentativeChunks(chunks)` prioritizing verified Table of Contents (TOC) chunks (pages 1-25) and chapter introductory chunks.
  - Enforced a strict budget (max 12 chunks / ~3500 tokens) staying well within Groq's 8,000 TPM limit.
- **Controlled Table of Contents Deterministic Fallback:**
  - Implemented `_extractFromTableOfContents(chunks, fileName)` as a deterministic fallback.
  - Automatically parses the 14 authentic textbook chapters from the TOC table and links numbered subsections (`1.1`, `2.1`) while filtering out math operators, measurements (`cm`), and boilerplate.

## Phase 4 Final Verification & Extraction Remediation Completion

### 1. Critical Citation Verification Remediation (Task 1)
- **Defect Identified:** `_verifyCitations` previously defaulted missing or unrecognized chunk candidate IDs to `defaultChunk = chunks[0]`. Because `chunks[0].id` existed in the document, any hallucinated or fake chunk reference was incorrectly assigned `verified: true` and `confidence: 'high'`.
- **Deterministic 4-Stage Citation Integrity Verifier (`TopicService._verifyCitations` & `TopicService._chunkSupportsTopic`):**
  1. **Chunk Existence:** Candidate ID must exist in `public.document_chunks` for this document. If missing or nonexistent, `resolveChunk` returns `null` (zero fallback to default chunk).
  2. **Document Ownership:** The resolved chunk's `document_id` must match `doc.id`. Cross-document references are strictly rejected.
  3. **User Ownership:** The resolved chunk's `user_id` must match `doc.user_id` (`auth.uid()`). Cross-user references are strictly rejected.
  4. **Content Support Validation:** The chunk text (`content` or `section_title`) must actually support the cited topic. Evaluates direct substring matches, section numbering (`1.1`), and significant keyword overlap (excluding stopwords).
- **Integrity Enforcement:**
  - `verified: true` and `confidence: 'high'` are assigned ONLY when all 4 checks pass.
  - Invalid, missing, cross-document, cross-user, or content-mismatched references produce `verified: false`, descriptive `verificationError`, and `confidence: 'unverified'`.
  - AI model payloads attempting to pass `verified: true` or `confidence: 'high'` are strictly overridden by deterministic backend validation.
- **Test Suite (`scratch/test_citation_verification_comprehensive.mjs` — 21/21 Passed):**
  - Test 1: Valid chunk reference supporting topic -> `verified: true`, `confidence: 'high'`.
  - Test 2: Nonexistent / Fake Chunk ID (`fake-hallucinated-chunk-id-12345`) -> `verified: false`, `confidence: 'unverified'`.
  - Test 3: Cross-document chunk reference -> `verified: false`, `confidence: 'unverified'`.
  - Test 4: Cross-user chunk reference -> `verified: false`, `confidence: 'unverified'`.
  - Test 5: Missing chunk ID -> `source_references: []`, `confidence: 'unverified'`.
  - Test 6: Valid chunk ID but content does not support topic -> `verified: false`, `confidence: 'unverified'`.
  - Test 7: AI payload claiming `verified: true` -> strictly rejected, `verified: false`, `confidence: 'unverified'`.

### 2. Resolution of 15 versus 14 Chapters (Task 2)
- **Root Cause:** Page 9 of `xth maths em.pdf` lists Chapters 1 to 14 (Real Numbers to Statistics). Following Chapter 14, page 357 lists `Appendix Mathematical Modelling 08 January 357 - 369`, followed by Answers and Revision. The Groq model extracted `Mathematical Modelling (Appendix Chapter)` as Chapter 15.
- **Curriculum Alignment:**
  - Updated Groq prompt instructions to explicitly extract ONLY the 14 official curriculum chapters and exclude appendices, answers, revisions, or end-matter.
  - Added post-extraction filter `isNonCurriculum` in `_extractWithGroq` to remove any appendix or non-curriculum chapters.
  - Enforced `chapNum <= 14` and filtered lines starting with `Appendix` in `_extractFromTableOfContents`.
- **E2E Live Verification (`scratch/test_maths_14_chapters_e2e.mjs`):**
  - Extracted all 14 authentic chapters in exact order: 1. Real Numbers, 2. Sets, 3. Polynomials, 4. Pair of Linear Equations in Two Variables, 5. Quadratic Equations, 6. Progressions, 7. Coordinate Geometry, 8. Similar Triangles, 9. Tangents and Secants to a Circle, 10. Mensuration, 11. Trigonometry, 12. Applications of Trigonometry, 13. Probability, 14. Statistics.
  - Zero 15th Appendix chapter.
  - Verified 14/14 citations from Page 9 TOC chunk (Chunk 32) in Supabase.
  - Verified zero mathematical noise (no single variables `x`, `sin`, `BD`, `cot 74`).

### 3. Document Deletion Safety & Migration 005 Review (Task 3)
- **Migration 005 Review:**
  - Original `database/005_cascade_document_deletion.sql` contained `DELETE FROM public.subjects WHERE source_document_id IS NULL;` which would destroy valid orphaned subjects (e.g. Manikanta's approved "Resume (6)" subject). This line was strictly excised.
  - An unconditional database-level `ON DELETE CASCADE` would bypass protection for reviewed/approved topic maps and student customizations.
  - Migration 005 remains in draft status: **PENDING USER APPROVAL — NOT EXECUTED REMOTELY**.
- **Application Deletion Safety (`DocumentService.deleteDocument` & `DocumentController.delete`):**
  - If a document is linked to an `approved` or `reviewed` topic map, or to topics with `studentEdited: true`, deletion is blocked with `HTTP 409 Conflict` (`code: 'CONFIRMATION_REQUIRED'`).
  - Deletion proceeds only when the user explicitly provides `confirmDiscard: true`.
  - Unedited `draft` subjects and their topics are cleaned up automatically with their source document, leaving zero orphaned subjects.
- **Test Suites (`scratch/test_document_deletion_safety.mjs` & `scratch/test_live_api_delete_safety.mjs`):**
  - Scenario 1: Draft without edits -> Cleaned up automatically upon document deletion (Passed).
  - Scenario 2: Approved subject -> Blocked with HTTP 409 Conflict; remains intact in Supabase; deleted cleanly upon `confirmDiscard: true` (Passed).
  - Scenario 3: Student-edited topics -> Blocked with HTTP 409 Conflict; remains intact; deleted upon `confirmDiscard: true` (Passed).
  - Scenario 4: Cross-user deletion -> Rejected with access denied (Passed).

### 4. Full Curriculum Hierarchy Live Verification
- **Verified Complete Telangana Class X Mathematics Hierarchy:**
  - Ran full application workflow via live API (`POST /api/documents/process` -> `POST /api/topics/extract` -> `GET /api/topics/detail` -> direct Supabase verification).
  - Extracted all 14 authentic curriculum chapters in exact syllabus sequence.
  - Extracted 85 authentic numbered subsections (topics) and 21 subtopics = 120 total hierarchy nodes.
  - 100% verified citations: 120 / 120 nodes verified against authentic document chunks with confidence: high.
  - Zero TOC citation duplication across hierarchy levels (Chapters reference Page 9 TOC chunk; subsections reference their specific textbook page chunks across Pages 11–361).
  - Zero mathematical expressions, exercise questions, or noise leaks.
  - Relational parity verified: API detail tree matches Supabase PostgreSQL database records exactly.
  - Cleaned up all disposable test artifacts cleanly via confirmed deletion.

### 5. Regression & Live Verification Summary
- **Live Local Server:** Running at `http://localhost:3000`.
- **Phase 1-4 Regression:** 100% green across Health (200), Auth (200), Upload/Process (200), RAG Retrieval (200), Topic Tree RPC (200), Student Edit Preservation (200), Citation Verifier (200), Deletion Safety (200).

### 6. Phase 5: Diagnostic Quiz Generation & Grounded Verification Summary
- **Database Schema:** `database/006_diagnostic_quizzes.sql` created for `quiz_attempts`, `quiz_questions`, and `quiz_answers` with Row-Level Security.
- **Verification Engine:** 4-stage citation verification (Existence, Document ID match, User ID match, Content Relevance) applied to every question before delivery.
- **4 Distinct Options:** Strictly enforced 4 mutually exclusive options (A, B, C, D) with exactly one correct option.
- **Answer Protection:** Correct options and explanations strictly hidden from client until submission.
- **Automated Test Suite (`scratch/test_phase5_quiz_engine.mjs`):** 33 / 33 assertions passed (100% Green).
- **Playwright End-to-End Test (`scratch/test_phase5_playwright_e2e.mjs`):** Passed 100% in Chromium, verifying interactive quiz generation, option selection, submission, and grounded scorecard review.
- **Safety Boundary Enforced:** Production student data completely intact (Document `bf81ec3d...`, Subject `173b9439...`, 120 curriculum nodes preserved). **Phase 6 & 7 strictly awaiting approval.**
