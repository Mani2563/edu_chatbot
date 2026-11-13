-- =========================================================================
-- GapFinder AI — Phase 5: Diagnostic Quizzes Hardened Schema & RPC
-- Migration: 006_diagnostic_quizzes.sql
-- 
-- Comprehensive Security & Integrity Architecture:
-- 1. Anti-Score Inflation: submit_quiz_attempt strictly rejects duplicate question IDs,
--    evaluates each question at most once, and ensures score cannot exceed total_questions.
-- 2. Strict 4-Option Validation: Enforces exactly 4 valid JSON objects, unique identifiers (A, B, C, D),
--    non-empty text, pairwise distinct text after normalization, and correct_option matching an existing ID.
-- 3. Trusted Server-Side Question Creation: save_quiz_attempt is restricted to service_role only
--    (revoked from PUBLIC, anon, authenticated). Prevents arbitrary client question injection.
-- 4. In-Database Citation Verification: citation_verified is determined by database chunk existence
--    and student/document ownership. Client-supplied booleans are ignored.
-- 5. Topic Hierarchy Enforcement: save_quiz_attempt uses a recursive query to verify that the topic
--    strictly descends from the specified chapter, both belong to the subject, and belong to the student.
-- 6. Strict Submission Validation: Rejects null/non-array payloads, malformed IDs, invalid options,
--    and questions outside the attempt. Unanswered questions do not inflate scores.
-- 7. Sensitive Column Mutation Guard: Triggers and restricted grants block direct client updates to
--    correct_option, explanation, score, percentage, status, and is_correct.
-- 8. Delete Resilience: Chunks and documents use ON DELETE SET NULL, preserving citation_snapshot
--    and historical reviews permanently.
-- 9. Zero Answer-Key Leakage Architecture:
--    - public.quiz_questions stores ONLY presentation metadata (text, options, order, citations).
--      correct_option and explanation columns DO NOT EXIST in this table.
--    - public.quiz_question_keys stores correct_option and explanation.
--    - Row-level security on quiz_question_keys STRICTLY restricts SELECT access to authenticated
--      students ONLY when their quiz attempt status is 'completed'. In-progress attempts yield 0 rows.
--    - public.quiz_attempt_reviews view dynamically masks correct_option and explanation to NULL
--      until attempt status is 'completed'.
--    - get_quiz_attempt_review RPC explicitly rejects reviews for in-progress attempts.
-- 10. Hardened SECURITY DEFINER Search Path:
--    - All functions use SET search_path = '' and explicit schema qualification (public.*, auth.*)
--      to eliminate search-path injection vectors.
-- 11. Strict Submission State Validation:
--    - submit_quiz_attempt requires attempt status to be strictly 'in_progress', rejecting both
--      'completed' and 'abandoned' attempts.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. TABLE: public.quiz_attempts
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    chapter_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
    topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
    scope TEXT NOT NULL DEFAULT 'topic' CHECK (scope IN ('topic', 'chapter', 'subject')),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    total_questions INTEGER NOT NULL CHECK (total_questions > 0),
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (percentage >= 0.00 AND percentage <= 100.00),
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    completed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_quiz_attempts_id_user UNIQUE (id, user_id),
    CONSTRAINT ck_quiz_attempts_score_cap CHECK (score <= total_questions)
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON public.quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_subject_id ON public.quiz_attempts(subject_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_topic_id ON public.quiz_attempts(topic_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_status ON public.quiz_attempts(status);

-- -------------------------------------------------------------------------
-- 2. TABLE: public.quiz_questions (Presentation Only — Zero Answer Leakage)
-- NOTE: correct_option and explanation are intentionally segregated into
-- public.quiz_question_keys to prevent pre-submission leakage via PostgREST/Supabase.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_order INTEGER NOT NULL CHECK (question_order > 0),
    question_text TEXT NOT NULL CHECK (char_length(trim(question_text)) >= 10),
    options JSONB NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    topic_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
    chapter_id UUID REFERENCES public.topics(id) ON DELETE SET NULL,
    source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    source_chunk_id UUID REFERENCES public.document_chunks(id) ON DELETE SET NULL,
    source_page_number INTEGER NULL,
    citation_verified BOOLEAN NOT NULL DEFAULT false,
    citation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_quiz_questions_id_attempt_user UNIQUE (id, attempt_id, user_id),
    CONSTRAINT uq_quiz_questions_attempt_order UNIQUE (attempt_id, question_order),
    CONSTRAINT ck_quiz_questions_options_array CHECK (
        jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4
    )
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_attempt_id ON public.quiz_questions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_user_id ON public.quiz_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_chunk_id ON public.quiz_questions(source_chunk_id);

-- -------------------------------------------------------------------------
-- 3. TABLE: public.quiz_question_keys (Secure Answer-Key Repository)
-- Accessible only by service_role and authenticated students on COMPLETED attempts.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_question_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    correct_option TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
    explanation TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_quiz_question_keys_question UNIQUE (question_id),
    CONSTRAINT fk_quiz_question_keys_question_attempt_user FOREIGN KEY (question_id, attempt_id, user_id)
        REFERENCES public.quiz_questions(id, attempt_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_question_keys_attempt_id ON public.quiz_question_keys(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_question_keys_user_id ON public.quiz_question_keys(user_id);

-- -------------------------------------------------------------------------
-- 4. TABLE: public.quiz_answers
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL,
    question_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    selected_option TEXT NULL CHECK (selected_option IN ('A', 'B', 'C', 'D')),
    is_correct BOOLEAN NOT NULL DEFAULT false,
    answered_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id),
    CONSTRAINT fk_quiz_answers_question FOREIGN KEY (question_id, attempt_id, user_id)
        REFERENCES public.quiz_questions(id, attempt_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_answers_attempt_id ON public.quiz_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_user_id ON public.quiz_answers(user_id);

-- -------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY & PERMISSIONS HARDENING
-- -------------------------------------------------------------------------
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_question_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answers ENABLE ROW LEVEL SECURITY;

-- Revoke all direct permissions from PUBLIC and anonymous role
REVOKE ALL ON public.quiz_attempts FROM PUBLIC, anon;
REVOKE ALL ON public.quiz_questions FROM PUBLIC, anon;
REVOKE ALL ON public.quiz_question_keys FROM PUBLIC, anon;
REVOKE ALL ON public.quiz_answers FROM PUBLIC, anon;

-- Authenticated role:
-- 1. Read own attempts and delete own attempts (cascade cleans questions, keys & answers)
-- 2. Read own questions (questions contain NO answer keys or explanations)
-- 3. Read own answer keys ONLY when attempt status is 'completed'
-- 4. Read own answers
-- 5. Direct INSERT / UPDATE on questions, keys, and answers is strictly REVOKED (handled via secure RPCs)
GRANT SELECT, DELETE ON public.quiz_attempts TO authenticated;
GRANT SELECT ON public.quiz_questions TO authenticated;
GRANT SELECT ON public.quiz_question_keys TO authenticated;
GRANT SELECT ON public.quiz_answers TO authenticated;

-- Service role retains full administrative access
GRANT ALL ON public.quiz_attempts TO service_role;
GRANT ALL ON public.quiz_questions TO service_role;
GRANT ALL ON public.quiz_question_keys TO service_role;
GRANT ALL ON public.quiz_answers TO service_role;

-- Clean existing policies if re-running
DROP POLICY IF EXISTS "Users can view own quiz attempts" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Users can delete own quiz attempts" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Users can view own quiz questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Users can view answer keys only for completed attempts" ON public.quiz_question_keys;
DROP POLICY IF EXISTS "Users can view own quiz answers" ON public.quiz_answers;
DROP POLICY IF EXISTS "Users can insert own quiz attempts" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Users can update own quiz attempts" ON public.quiz_attempts;
DROP POLICY IF EXISTS "Users can insert own quiz questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Users can update own quiz questions" ON public.quiz_questions;
DROP POLICY IF EXISTS "Users can insert own quiz answers" ON public.quiz_answers;
DROP POLICY IF EXISTS "Users can update own quiz answers" ON public.quiz_answers;

-- Strict read-only / delete RLS policies for authenticated users
CREATE POLICY "Users can view own quiz attempts" ON public.quiz_attempts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own quiz attempts" ON public.quiz_attempts
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own quiz questions" ON public.quiz_questions
    FOR SELECT USING (auth.uid() = user_id);

-- Secure Answer-Key Access Policy:
-- Authenticated students may ONLY read answer keys when the attempt is COMPLETED!
CREATE POLICY "Users can view answer keys only for completed attempts" ON public.quiz_question_keys
    FOR SELECT USING (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.quiz_attempts a
            WHERE a.id = quiz_question_keys.attempt_id
              AND a.user_id = auth.uid()
              AND a.status = 'completed'
        )
    );

CREATE POLICY "Users can view own quiz answers" ON public.quiz_answers
    FOR SELECT USING (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 6. SECURE REVIEW VIEW: public.quiz_attempt_reviews
-- Dynamically exposes correct answers and explanations ONLY when status = 'completed'.
-- Enforces security_invoker = true and explicit user isolation.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.quiz_attempt_reviews
WITH (security_invoker = true) AS
SELECT 
    q.id AS question_id,
    q.attempt_id,
    q.user_id,
    q.question_order,
    q.question_text,
    q.options,
    q.difficulty,
    q.topic_id,
    q.chapter_id,
    q.source_document_id,
    q.source_chunk_id,
    q.source_page_number,
    q.citation_verified,
    q.citation_snapshot,
    ans.selected_option,
    ans.is_correct,
    CASE WHEN att.status = 'completed' THEN k.correct_option ELSE NULL END AS correct_option,
    CASE WHEN att.status = 'completed' THEN k.explanation ELSE NULL END AS explanation,
    q.created_at
FROM public.quiz_questions q
JOIN public.quiz_attempts att ON att.id = q.attempt_id AND att.user_id = q.user_id
LEFT JOIN public.quiz_answers ans ON ans.attempt_id = q.attempt_id AND ans.question_id = q.id AND ans.user_id = q.user_id
LEFT JOIN public.quiz_question_keys k ON k.question_id = q.id AND k.user_id = q.user_id
WHERE (auth.uid() IS NOT NULL AND q.user_id = auth.uid()) OR auth.role() = 'service_role';

GRANT SELECT ON public.quiz_attempt_reviews TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 7. TRIGGER: RESTRICT DIRECT UPDATE ACCESS TO SENSITIVE FIELDS
-- Hardened with SET search_path = '' to eliminate search-path injection.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_quiz_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- Allow internal execution (from within our SECURITY DEFINER RPCs) or service_role
    IF current_setting('gapfinder.internal_call', true) = 'true' OR auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Block direct client mutation of sensitive columns
    IF TG_TABLE_NAME = 'quiz_attempts' THEN
        IF OLD.score IS DISTINCT FROM NEW.score OR
           OLD.percentage IS DISTINCT FROM NEW.percentage OR
           OLD.status IS DISTINCT FROM NEW.status OR
           OLD.user_id IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'Direct modification of quiz attempt score, percentage, status, or user_id is prohibited';
        END IF;
    ELSIF TG_TABLE_NAME = 'quiz_questions' THEN
        IF OLD.user_id IS DISTINCT FROM NEW.user_id OR
           OLD.attempt_id IS DISTINCT FROM NEW.attempt_id THEN
            RAISE EXCEPTION 'Direct modification of quiz question user_id or attempt_id is prohibited';
        END IF;
    ELSIF TG_TABLE_NAME = 'quiz_question_keys' THEN
        IF OLD.correct_option IS DISTINCT FROM NEW.correct_option OR
           OLD.explanation IS DISTINCT FROM NEW.explanation OR
           OLD.user_id IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'Direct modification of quiz question keys is prohibited';
        END IF;
    ELSIF TG_TABLE_NAME = 'quiz_answers' THEN
        IF OLD.is_correct IS DISTINCT FROM NEW.is_correct OR
           OLD.user_id IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'Direct modification of quiz answer is_correct or user_id is prohibited';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_quiz_attempts ON public.quiz_attempts;
CREATE TRIGGER trg_protect_quiz_attempts
    BEFORE UPDATE ON public.quiz_attempts
    FOR EACH ROW EXECUTE FUNCTION public.protect_quiz_sensitive_columns();

DROP TRIGGER IF EXISTS trg_protect_quiz_questions ON public.quiz_questions;
CREATE TRIGGER trg_protect_quiz_questions
    BEFORE UPDATE ON public.quiz_questions
    FOR EACH ROW EXECUTE FUNCTION public.protect_quiz_sensitive_columns();

DROP TRIGGER IF EXISTS trg_protect_quiz_question_keys ON public.quiz_question_keys;
CREATE TRIGGER trg_protect_quiz_question_keys
    BEFORE UPDATE ON public.quiz_question_keys
    FOR EACH ROW EXECUTE FUNCTION public.protect_quiz_sensitive_columns();

DROP TRIGGER IF EXISTS trg_protect_quiz_answers ON public.quiz_answers;
CREATE TRIGGER trg_protect_quiz_answers
    BEFORE UPDATE ON public.quiz_answers
    FOR EACH ROW EXECUTE FUNCTION public.protect_quiz_sensitive_columns();

-- -------------------------------------------------------------------------
-- 8. RPC: public.save_quiz_attempt
-- Restricted to service_role only. Validates complete curriculum hierarchy,
-- four distinct options, chunk ownership, and citation integrity.
-- Segregates questions and secret answer keys into separate tables.
-- Hardened with SET search_path = '' and fully schema-qualified identifiers.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_quiz_attempt(
    p_attempt JSONB,
    p_questions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_attempt_id UUID;
    v_subject_id UUID;
    v_source_doc_id UUID;
    v_chapter_id UUID;
    v_topic_id UUID;
    v_item JSONB;
    v_q_id UUID;
    v_q_chunk_id UUID;
    v_q_order INTEGER;
    v_total_questions INTEGER;
    v_options JSONB;
    v_opt_item JSONB;
    v_opt_idx INTEGER;
    v_opt_id TEXT;
    v_opt_text TEXT;
    v_seen_opt_ids TEXT[];
    v_seen_opt_texts TEXT[];
    v_correct_opt TEXT;
    v_citation_verified BOOLEAN;
BEGIN
    -- 1. Trust boundary: Only server-side service_role may call save_quiz_attempt
    -- Authenticated students cannot call this RPC directly (prevents arbitrary question injection)
    IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: save_quiz_attempt may only be invoked by trusted server-side service role';
    END IF;

    v_user_id := (p_attempt->>'user_id')::UUID;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required in attempt payload';
    END IF;

    -- Verify user exists in auth.users
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
        RAISE EXCEPTION 'User % not found in auth.users', v_user_id;
    END IF;

    -- 2. Validate Subject Ownership
    v_subject_id := (p_attempt->>'subject_id')::UUID;
    IF v_subject_id IS NULL THEN
        RAISE EXCEPTION 'subject_id is required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.subjects
        WHERE id = v_subject_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Subject % not found or access denied', v_subject_id;
    END IF;

    -- 3. Validate Source Document Ownership & Relationship
    v_source_doc_id := NULLIF(p_attempt->>'source_document_id', '')::UUID;
    IF v_source_doc_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.documents
            WHERE id = v_source_doc_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'Source document % not found or access denied', v_source_doc_id;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.subjects
            WHERE id = v_subject_id AND source_document_id = v_source_doc_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'Subject % does not match source document %', v_subject_id, v_source_doc_id;
        END IF;
    END IF;

    -- 4. Validate Chapter Relationship
    v_chapter_id := NULLIF(p_attempt->>'chapter_id', '')::UUID;
    IF v_chapter_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.topics
            WHERE id = v_chapter_id 
              AND subject_id = v_subject_id 
              AND user_id = v_user_id
              AND hierarchy_level IN ('chapter', 'unit')
        ) THEN
            RAISE EXCEPTION 'Chapter % does not belong to subject % or access denied', v_chapter_id, v_subject_id;
        END IF;
    END IF;

    -- 5. Validate Topic Relationship & Hierarchy Tree Ancestry
    v_topic_id := NULLIF(p_attempt->>'topic_id', '')::UUID;
    IF v_topic_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.topics
            WHERE id = v_topic_id AND subject_id = v_subject_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'Topic % does not belong to subject % or access denied', v_topic_id, v_subject_id;
        END IF;

        -- Strict Hierarchy Check: If chapter_id is also supplied, topic MUST descend from chapter
        IF v_chapter_id IS NOT NULL AND v_topic_id <> v_chapter_id THEN
            IF NOT EXISTS (
                WITH RECURSIVE topic_ancestors AS (
                    SELECT id, parent_topic_id FROM public.topics WHERE id = v_topic_id
                    UNION ALL
                    SELECT t.id, t.parent_topic_id FROM public.topics t
                    JOIN topic_ancestors a ON t.id = a.parent_topic_id
                )
                SELECT 1 FROM topic_ancestors WHERE id = v_chapter_id
            ) THEN
                RAISE EXCEPTION 'Topic % does not belong to chapter % in the curriculum hierarchy', v_topic_id, v_chapter_id;
            END IF;
        END IF;
    END IF;

    -- 6. Validate Question Array
    IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
        RAISE EXCEPTION 'p_questions must be a JSON array';
    END IF;

    v_total_questions := jsonb_array_length(p_questions);
    IF v_total_questions = 0 THEN
        RAISE EXCEPTION 'Quiz must contain at least one question';
    END IF;

    v_attempt_id := COALESCE(NULLIF(p_attempt->>'id', '')::UUID, gen_random_uuid());

    -- Internal config flag for trigger bypass during authorized RPC
    PERFORM set_config('gapfinder.internal_call', 'true', true);

    -- 7. Insert Attempt
    INSERT INTO public.quiz_attempts (
        id,
        user_id,
        subject_id,
        source_document_id,
        chapter_id,
        topic_id,
        scope,
        difficulty,
        total_questions,
        score,
        percentage,
        status,
        created_at,
        updated_at
    ) VALUES (
        v_attempt_id,
        v_user_id,
        v_subject_id,
        v_source_doc_id,
        v_chapter_id,
        v_topic_id,
        COALESCE(p_attempt->>'scope', 'topic'),
        p_attempt->>'difficulty',
        v_total_questions,
        0,
        0.00,
        'in_progress',
        NOW(),
        NOW()
    );

    -- 8. Insert Questions with Full Four-Option Validation & In-Database Citation Verification
    v_q_order := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_questions)
    LOOP
        v_q_order := v_q_order + 1;
        v_q_id := COALESCE(NULLIF(v_item->>'id', '')::UUID, gen_random_uuid());
        v_q_chunk_id := NULLIF(v_item->>'source_chunk_id', '')::UUID;

        -- In-Database Citation Verification:
        -- Never trust client-supplied citation_verified flag; verify against public.document_chunks
        IF v_q_chunk_id IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.document_chunks
                WHERE id = v_q_chunk_id 
                  AND (v_source_doc_id IS NULL OR document_id = v_source_doc_id)
                  AND user_id = v_user_id
            ) THEN
                RAISE EXCEPTION 'Source chunk % does not belong to document % or authenticated student', v_q_chunk_id, v_source_doc_id;
            END IF;
            v_citation_verified := true;
        ELSE
            v_citation_verified := false;
        END IF;

        -- Four-Option Validation:
        v_options := v_item->'options';
        IF v_options IS NULL OR jsonb_typeof(v_options) <> 'array' OR jsonb_array_length(v_options) <> 4 THEN
            RAISE EXCEPTION 'Question % must have exactly 4 options in an array', v_q_order;
        END IF;

        v_seen_opt_ids := ARRAY[]::TEXT[];
        v_seen_opt_texts := ARRAY[]::TEXT[];

        FOR v_opt_idx IN 0..3
        LOOP
            v_opt_item := v_options->v_opt_idx;
            IF jsonb_typeof(v_opt_item) <> 'object' THEN
                RAISE EXCEPTION 'Question % option index % must be a JSON object', v_q_order, v_opt_idx;
            END IF;

            v_opt_id := upper(trim(COALESCE(v_opt_item->>'id', '')));
            v_opt_text := lower(trim(COALESCE(v_opt_item->>'text', '')));

            -- Validate identifier is A, B, C, or D
            IF v_opt_id NOT IN ('A', 'B', 'C', 'D') THEN
                RAISE EXCEPTION 'Question % option % has invalid identifier "%"; must be A, B, C, or D', v_q_order, v_opt_idx + 1, v_opt_id;
            END IF;

            -- Check for duplicate identifier
            IF v_opt_id = ANY(v_seen_opt_ids) THEN
                RAISE EXCEPTION 'Question % has duplicate option identifier "%"', v_q_order, v_opt_id;
            END IF;
            v_seen_opt_ids := array_append(v_seen_opt_ids, v_opt_id);

            -- Check for empty option text
            IF v_opt_text IS NULL OR v_opt_text = '' THEN
                RAISE EXCEPTION 'Question % option "%" must not have empty text', v_q_order, v_opt_id;
            END IF;

            -- Check for duplicate option text after normalization
            IF v_opt_text = ANY(v_seen_opt_texts) THEN
                RAISE EXCEPTION 'Question % has duplicate option text after normalization: "%"', v_q_order, v_opt_item->>'text';
            END IF;
            v_seen_opt_texts := array_append(v_seen_opt_texts, v_opt_text);
        END LOOP;

        -- Validate correct_option corresponds to one of the 4 defined options
        v_correct_opt := upper(trim(COALESCE(v_item->>'correct_option', '')));
        IF v_correct_opt NOT IN ('A', 'B', 'C', 'D') OR NOT (v_correct_opt = ANY(v_seen_opt_ids)) THEN
            RAISE EXCEPTION 'Question % has invalid correct_option "%"; must be one of the defined option identifiers (A, B, C, D)', v_q_order, v_correct_opt;
        END IF;

        -- 8.1 Insert Question Presentation Data (NO answer keys stored here)
        INSERT INTO public.quiz_questions (
            id,
            attempt_id,
            user_id,
            question_order,
            question_text,
            options,
            difficulty,
            topic_id,
            chapter_id,
            source_document_id,
            source_chunk_id,
            source_page_number,
            citation_verified,
            citation_snapshot,
            created_at
        ) VALUES (
            v_q_id,
            v_attempt_id,
            v_user_id,
            v_q_order,
            v_item->>'question_text',
            v_options,
            v_item->>'difficulty',
            v_topic_id,
            v_chapter_id,
            v_source_doc_id,
            v_q_chunk_id,
            NULLIF(v_item->>'source_page_number', '')::INTEGER,
            v_citation_verified,
            COALESCE(v_item->'citation_snapshot', '{}'::JSONB),
            NOW()
        );

        -- 8.2 Insert Answer Key into Secure Repository
        INSERT INTO public.quiz_question_keys (
            id,
            question_id,
            attempt_id,
            user_id,
            correct_option,
            explanation,
            created_at
        ) VALUES (
            gen_random_uuid(),
            v_q_id,
            v_attempt_id,
            v_user_id,
            v_correct_opt,
            v_item->>'explanation',
            NOW()
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', v_attempt_id,
        'total_questions', v_total_questions
    );
END;
$$;

-- Secure execution privileges: Strictly restricted to service_role
REVOKE ALL ON FUNCTION public.save_quiz_attempt(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_quiz_attempt(JSONB, JSONB) TO service_role;

-- -------------------------------------------------------------------------
-- 9. RPC: public.submit_quiz_attempt
-- Evaluates answers strictly inside PostgreSQL using public.quiz_question_keys.
-- Prevents duplicate answer score inflation, caps score, and rejects foreign questions.
-- Hardened with SET search_path = '' and fully schema-qualified identifiers.
-- Requires attempt status to be strictly 'in_progress' (rejects 'completed' and 'abandoned').
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(
    p_attempt_id UUID,
    p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_status TEXT;
    v_total_questions INTEGER;
    v_score INTEGER := 0;
    v_percentage NUMERIC(5, 2) := 0.00;
    v_item JSONB;
    v_q_id UUID;
    v_raw_selected TEXT;
    v_selected_option TEXT;
    v_correct_option TEXT;
    v_explanation TEXT;
    v_is_correct BOOLEAN;
    v_completed_at TIMESTAMPTZ;
    v_seen_questions UUID[] := ARRAY[]::UUID[];
    v_evaluated_answers JSONB := '[]'::JSONB;
BEGIN
    -- 1. Enforce authenticated student session or service_role
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        IF auth.role() = 'service_role' THEN
            SELECT user_id INTO v_user_id FROM public.quiz_attempts WHERE id = p_attempt_id;
        END IF;
    END IF;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid student authentication required';
    END IF;

    IF p_attempt_id IS NULL THEN
        RAISE EXCEPTION 'p_attempt_id is required';
    END IF;

    -- 2. Reject null or non-array submission payload
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
        RAISE EXCEPTION 'p_answers must be a valid JSON array';
    END IF;

    -- 3. Row lock attempt and verify ownership & in_progress status
    SELECT status, total_questions INTO v_status, v_total_questions
    FROM public.quiz_attempts
    WHERE id = p_attempt_id AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz attempt % not found or access denied', p_attempt_id;
    END IF;

    -- Require status to be strictly 'in_progress'. Reject both 'completed' and 'abandoned'
    IF v_status = 'completed' THEN
        RAISE EXCEPTION 'Quiz attempt % has already been completed. Resubmission is prohibited.', p_attempt_id;
    ELSIF v_status = 'abandoned' THEN
        RAISE EXCEPTION 'Quiz attempt % has been abandoned. Submitting an abandoned attempt is prohibited.', p_attempt_id;
    ELSIF v_status <> 'in_progress' THEN
        RAISE EXCEPTION 'Quiz attempt % is in invalid state "%" for submission; must be in_progress.', p_attempt_id, v_status;
    END IF;

    -- 4. Set internal config flag for trigger bypass
    PERFORM set_config('gapfinder.internal_call', 'true', true);

    -- 5. Evaluate each submitted answer
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers)
    LOOP
        -- Reject missing or malformed question ID
        IF v_item->>'question_id' IS NULL OR trim(v_item->>'question_id') = '' THEN
            RAISE EXCEPTION 'Every answer item must specify a valid question_id';
        END IF;

        BEGIN
            v_q_id := (v_item->>'question_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Malformed question_id "%" in submission payload', v_item->>'question_id';
        END;

        -- Anti-Inflation: Reject duplicate question IDs in payload
        IF v_q_id = ANY(v_seen_questions) THEN
            RAISE EXCEPTION 'Duplicate question ID % detected in submission payload', v_q_id;
        END IF;
        v_seen_questions := array_append(v_seen_questions, v_q_id);

        -- Validate selected_option format
        v_raw_selected := trim(v_item->>'selected_option');
        IF v_raw_selected IS NOT NULL AND v_raw_selected <> '' THEN
            v_selected_option := upper(v_raw_selected);
            IF v_selected_option NOT IN ('A', 'B', 'C', 'D') THEN
                RAISE EXCEPTION 'Invalid selected_option "%" for question %; must be A, B, C, D, or null', v_raw_selected, v_q_id;
            END IF;
        ELSE
            v_selected_option := NULL;
        END IF;

        -- Cross-Attempt Check: Verify question strictly belongs to this attempt and student,
        -- and fetch authoritative answer key from public.quiz_question_keys
        SELECT k.correct_option, k.explanation INTO v_correct_option, v_explanation
        FROM public.quiz_question_keys k
        JOIN public.quiz_questions q ON q.id = k.question_id
        WHERE k.question_id = v_q_id AND k.attempt_id = p_attempt_id AND k.user_id = v_user_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Question % does not belong to attempt % or access denied', v_q_id, p_attempt_id;
        END IF;

        -- Compute correctness strictly inside PostgreSQL (never trust client)
        v_is_correct := (v_selected_option IS NOT NULL AND v_selected_option = v_correct_option);
        IF v_is_correct THEN
            v_score := v_score + 1;
        END IF;

        -- Insert or update evaluated answer
        INSERT INTO public.quiz_answers (
            id,
            attempt_id,
            question_id,
            user_id,
            selected_option,
            is_correct,
            answered_at
        ) VALUES (
            gen_random_uuid(),
            p_attempt_id,
            v_q_id,
            v_user_id,
            v_selected_option,
            v_is_correct,
            NOW()
        )
        ON CONFLICT (attempt_id, question_id) DO UPDATE
        SET selected_option = EXCLUDED.selected_option,
            is_correct = EXCLUDED.is_correct,
            answered_at = NOW();

        v_evaluated_answers := v_evaluated_answers || jsonb_build_object(
            'question_id', v_q_id,
            'selected_option', v_selected_option,
            'correct_option', v_correct_option,
            'is_correct', v_is_correct,
            'explanation', v_explanation
        );
    END LOOP;

    -- Ensure score never exceeds total_questions
    v_score := LEAST(v_score, v_total_questions);

    -- 6. Calculate percentage strictly in PostgreSQL
    IF v_total_questions > 0 THEN
        v_percentage := ROUND((v_score::NUMERIC / v_total_questions::NUMERIC) * 100.0, 2);
    ELSE
        v_percentage := 0.00;
    END IF;

    v_completed_at := NOW();

    -- 7. Atomically update attempt status to 'completed' with database-calculated score
    UPDATE public.quiz_attempts
    SET score = v_score,
        percentage = v_percentage,
        status = 'completed',
        completed_at = v_completed_at,
        updated_at = v_completed_at
    WHERE id = p_attempt_id AND user_id = v_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'attempt_id', p_attempt_id,
        'score', v_score,
        'total_questions', v_total_questions,
        'percentage', v_percentage,
        'completed_at', v_completed_at,
        'evaluated_answers', v_evaluated_answers
    );
END;
$$;

-- Secure execution privileges
REVOKE ALL ON FUNCTION public.submit_quiz_attempt(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, JSONB) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 10. RPC: public.get_quiz_attempt_review
-- Secure review function: rejects in-progress attempts; provides full verified
-- review for completed attempts.
-- Hardened with SET search_path = '' and fully schema-qualified identifiers.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_quiz_attempt_review(
    p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_attempt RECORD;
    v_review JSONB := '[]'::JSONB;
    v_item RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        IF auth.role() = 'service_role' THEN
            SELECT user_id INTO v_user_id FROM public.quiz_attempts WHERE id = p_attempt_id;
        END IF;
    END IF;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid student authentication required';
    END IF;

    SELECT * INTO v_attempt
    FROM public.quiz_attempts
    WHERE id = p_attempt_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz attempt % not found or access denied', p_attempt_id;
    END IF;

    IF v_attempt.status <> 'completed' THEN
        RAISE EXCEPTION 'Quiz attempt % is still in progress. Review is only accessible after completion.', p_attempt_id;
    END IF;

    FOR v_item IN
        SELECT 
            q.id AS question_id,
            q.question_order,
            q.question_text,
            q.options,
            q.difficulty,
            q.source_chunk_id,
            q.source_page_number,
            q.citation_verified,
            q.citation_snapshot,
            ans.selected_option,
            ans.is_correct,
            k.correct_option,
            k.explanation
        FROM public.quiz_questions q
        LEFT JOIN public.quiz_answers ans ON ans.attempt_id = q.attempt_id AND ans.question_id = q.id
        LEFT JOIN public.quiz_question_keys k ON k.question_id = q.id
        WHERE q.attempt_id = p_attempt_id AND q.user_id = v_user_id
        ORDER BY q.question_order ASC
    LOOP
        v_review := v_review || jsonb_build_object(
            'question_id', v_item.question_id,
            'question_order', v_item.question_order,
            'question_text', v_item.question_text,
            'options', v_item.options,
            'difficulty', v_item.difficulty,
            'selected_option', v_item.selected_option,
            'correct_option', v_item.correct_option,
            'is_correct', COALESCE(v_item.is_correct, false),
            'explanation', v_item.explanation,
            'source_reference', jsonb_build_object(
                'chunk_id', v_item.source_chunk_id,
                'page_number', v_item.source_page_number,
                'verified', v_item.citation_verified,
                'citation_snapshot', v_item.citation_snapshot
            )
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'attempt', to_jsonb(v_attempt),
        'review', v_review
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_attempt_review(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_review(UUID) TO authenticated, service_role;
