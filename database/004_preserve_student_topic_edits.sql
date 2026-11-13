-- =========================================================================
-- Migration: 004_preserve_student_topic_edits.sql
-- Function: public.save_topic_tree (Version 2)
-- Purpose: Protects reviewed and approved topic maps, preserves student edits
--          during re-extraction, and enforces explicit confirmation before
--          any student-edited topics can be discarded.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.save_topic_tree(
    p_source_document_id UUID,
    p_subject_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_fingerprint TEXT,
    p_metadata JSONB,
    p_topics_data JSONB,
    p_force_reextract BOOLEAN DEFAULT FALSE,
    p_confirm_discard_edits BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_user_id UUID;
    v_existing_subject public.subjects%ROWTYPE;
    v_subject_id UUID;
    v_subject_record public.subjects%ROWTYPE;
    v_topic RECORD;
    v_inserted_count INTEGER := 0;
    v_existing_edited_count INTEGER := 0;
    v_payload_edited_count INTEGER := 0;
BEGIN
    -- 1. Validate Authenticated Context
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid authentication required';
    END IF;

    -- 2. Verify Document Ownership
    IF p_source_document_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.documents
            WHERE id = p_source_document_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'Source document not found or access denied';
        END IF;
    END IF;

    -- 3. Check for existing subject and acquire row-level lock
    SELECT * INTO v_existing_subject
    FROM public.subjects
    WHERE user_id = v_user_id AND source_document_id = p_source_document_id
    FOR UPDATE;

    IF FOUND THEN
        -- Task 1: Protect BOTH reviewed and approved topic maps
        IF v_existing_subject.status IN ('reviewed', 'approved') AND NOT COALESCE(p_force_reextract, FALSE) THEN
            RAISE EXCEPTION 'Syllabus already has a % topic map. Set forceReextract=true to replace reviewed or approved topics.', v_existing_subject.status;
        END IF;

        v_subject_id := v_existing_subject.id;

        -- Task 3 & 4: Count existing student-edited nodes
        SELECT COUNT(*) INTO v_existing_edited_count
        FROM public.topics
        WHERE subject_id = v_subject_id
          AND (extraction_metadata->>'studentEdited')::boolean = true;

        -- Count preserved student-edited nodes in incoming payload
        IF p_topics_data IS NOT NULL AND jsonb_array_length(p_topics_data) > 0 THEN
            SELECT COUNT(*) INTO v_payload_edited_count
            FROM jsonb_to_recordset(p_topics_data) AS x(extraction_metadata JSONB)
            WHERE (x.extraction_metadata->>'studentEdited')::boolean = true;
        END IF;

        -- If existing student edits would be lost, require explicit confirm_discard_edits
        IF v_existing_edited_count > v_payload_edited_count AND NOT COALESCE(p_confirm_discard_edits, FALSE) THEN
            RAISE EXCEPTION 'Subject contains % student-edited topic(s) that would be discarded. Set confirmDiscardEdits=true to authorize discarding edits.',
                (v_existing_edited_count - v_payload_edited_count);
        END IF;

        -- Atomically clear previous topics within the transaction
        DELETE FROM public.topics WHERE subject_id = v_subject_id;

        -- Update subject attributes
        UPDATE public.subjects
        SET name = COALESCE(p_name, v_existing_subject.name),
            description = p_description,
            fingerprint = p_fingerprint,
            metadata = COALESCE(p_metadata, '{}'::jsonb),
            status = 'draft',
            updated_at = NOW()
        WHERE id = v_subject_id
        RETURNING * INTO v_subject_record;
    ELSE
        -- Insert new subject
        v_subject_id := COALESCE(p_subject_id, gen_random_uuid());

        INSERT INTO public.subjects (
            id,
            user_id,
            source_document_id,
            name,
            description,
            status,
            fingerprint,
            metadata,
            created_at,
            updated_at
        ) VALUES (
            v_subject_id,
            v_user_id,
            p_source_document_id,
            p_name,
            p_description,
            'draft',
            p_fingerprint,
            COALESCE(p_metadata, '{}'::jsonb),
            NOW(),
            NOW()
        )
        RETURNING * INTO v_subject_record;
    END IF;

    -- 4. Insert Topics Hierarchy in Strict Order (units -> chapters -> topics -> subtopics)
    IF p_topics_data IS NOT NULL AND jsonb_array_length(p_topics_data) > 0 THEN
        FOR v_topic IN
            SELECT * FROM jsonb_to_recordset(p_topics_data) AS x(
                id UUID,
                parent_topic_id UUID,
                name TEXT,
                description TEXT,
                hierarchy_level TEXT,
                display_order INTEGER,
                source_references JSONB,
                extraction_metadata JSONB
            )
            ORDER BY
                CASE hierarchy_level
                    WHEN 'unit' THEN 1
                    WHEN 'chapter' THEN 2
                    WHEN 'topic' THEN 3
                    WHEN 'subtopic' THEN 4
                    ELSE 5
                END,
                COALESCE(display_order, 0) ASC
        LOOP
            INSERT INTO public.topics (
                id,
                subject_id,
                user_id,
                parent_topic_id,
                name,
                description,
                hierarchy_level,
                display_order,
                source_references,
                extraction_metadata,
                created_at,
                updated_at
            ) VALUES (
                v_topic.id,
                v_subject_id,
                v_user_id,
                v_topic.parent_topic_id,
                v_topic.name,
                v_topic.description,
                v_topic.hierarchy_level,
                COALESCE(v_topic.display_order, 0),
                COALESCE(v_topic.source_references, '[]'::jsonb),
                COALESCE(v_topic.extraction_metadata, '{}'::jsonb),
                NOW(),
                NOW()
            );
            v_inserted_count := v_inserted_count + 1;
        END LOOP;
    END IF;

    -- 5. Return JSONB payload with subject and insertion statistics
    RETURN jsonb_build_object(
        'success', TRUE,
        'subject', to_jsonb(v_subject_record),
        'insertedCount', v_inserted_count,
        'preservedEditsCount', v_payload_edited_count
    );
END;
$$;

-- Revoke default public execution and grant strictly to authenticated role
REVOKE ALL ON FUNCTION public.save_topic_tree(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_topic_tree(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, BOOLEAN, BOOLEAN) TO authenticated;

