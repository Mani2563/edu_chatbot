-- =========================================================================
-- Migration: 005_cascade_document_deletion.sql (PROPOSED / REVIEW DRAFT)
-- Purpose: Explains and provides safe cascade deletion mechanisms for
--          public.documents, public.subjects, and public.topics.
--
-- STATUS: PENDING USER APPROVAL — DO NOT EXECUTE REMOTELY WITHOUT AUTHORIZATION.
--
-- CRITICAL SAFETY REVIEW:
-- 1. Destructive unconditional orphan cleanup (DELETE WHERE source_document_id IS NULL)
--    has been strictly removed to prevent data loss on existing student subjects
--    (e.g. approved curriculum maps or standalone subjects).
-- 2. Direct unconditional ON DELETE CASCADE at the foreign-key level is unsafe
--    because it would bypass protection for 'reviewed' and 'approved' topic maps
--    and student customizations (studentEdited = true).
-- 3. Application layer enforces safe deletion in services/document-service.js:
--    - Draft subjects with no edits are cleaned up automatically upon document deletion.
--    - Reviewed/approved maps or maps with student customizations return HTTP 409
--      requiring explicit user confirmation (confirmDiscard: true).
-- =========================================================================

-- Optional: If database-level trigger protection is desired in addition to
-- application-level service checks, the trigger below enforces that reviewed/approved
-- topic maps or student-edited topics cannot be deleted without setting a transaction flag.

/*
CREATE OR REPLACE FUNCTION public.check_document_deletion_safety()
RETURNS TRIGGER AS $$
DECLARE
    v_subject RECORD;
    v_edited_count INT;
    v_confirm TEXT;
BEGIN
    -- Check if document has an associated subject
    SELECT id, name, status INTO v_subject
    FROM public.subjects
    WHERE source_document_id = OLD.id AND user_id = auth.uid();

    IF FOUND THEN
        -- Check if topic map is reviewed or approved
        IF v_subject.status IN ('reviewed', 'approved') THEN
            BEGIN
                v_confirm := current_setting('gapfinder.confirm_discard', true);
            EXCEPTION WHEN OTHERS THEN
                v_confirm := 'false';
            END;

            IF v_confirm IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'Cannot delete document: linked to an % topic map ("%"). Explicit confirmation required.',
                    v_subject.status, v_subject.name
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        -- Check if student edits exist
        SELECT COUNT(*) INTO v_edited_count
        FROM public.topics
        WHERE subject_id = v_subject.id
          AND (extraction_metadata->>'studentEdited')::boolean = true;

        IF v_edited_count > 0 THEN
            BEGIN
                v_confirm := current_setting('gapfinder.confirm_discard', true);
            EXCEPTION WHEN OTHERS THEN
                v_confirm := 'false';
            END;

            IF v_confirm IS DISTINCT FROM 'true' THEN
                RAISE EXCEPTION 'Cannot delete document: linked topic map has % student customization(s). Explicit confirmation required.',
                    v_edited_count
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;

        -- Safe to delete subject and topic hierarchy
        DELETE FROM public.subjects WHERE id = v_subject.id;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

DROP TRIGGER IF EXISTS trg_document_deletion_safety ON public.documents;
CREATE TRIGGER trg_document_deletion_safety
    BEFORE DELETE ON public.documents
    FOR EACH ROW
    EXECUTE FUNCTION public.check_document_deletion_safety();
*/

