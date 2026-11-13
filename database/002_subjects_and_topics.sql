-- =========================================================================
-- Migration: 002_subjects_and_topics.sql
-- Tables: public.subjects, public.topics
-- Purpose: Hierarchical topic maps grounded in syllabus documents with strict
--          database integrity, ownership enforcement, and review statuses.
-- =========================================================================

-- 1. Table: public.subjects
CREATE TABLE IF NOT EXISTS public.subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved')),
    fingerprint TEXT NULL, -- Content hash for duplicate prevention & versioning
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_subjects_user_source UNIQUE (user_id, source_document_id)
);

-- Indexes for subjects
CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON public.subjects(user_id);
CREATE INDEX IF NOT EXISTS idx_subjects_source_doc ON public.subjects(source_document_id);

-- Enable RLS for subjects
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

-- User Ownership Policies (Strict isolation per auth.uid(), idempotent)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subjects' AND policyname = 'Users can view own subjects') THEN
        CREATE POLICY "Users can view own subjects" ON public.subjects FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subjects' AND policyname = 'Users can insert own subjects') THEN
        CREATE POLICY "Users can insert own subjects" ON public.subjects FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subjects' AND policyname = 'Users can update own subjects') THEN
        CREATE POLICY "Users can update own subjects" ON public.subjects FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subjects' AND policyname = 'Users can delete own subjects') THEN
        CREATE POLICY "Users can delete own subjects" ON public.subjects FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;


-- 2. Table: public.topics
CREATE TABLE IF NOT EXISTS public.topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_topic_id UUID NULL,
    name TEXT NOT NULL,
    description TEXT NULL,
    hierarchy_level TEXT NOT NULL CHECK (hierarchy_level IN ('unit', 'chapter', 'topic', 'subtopic')),
    display_order INTEGER NOT NULL DEFAULT 0,
    source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
    extraction_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Enforce composite uniqueness to support cross-table relational integrity
    CONSTRAINT uq_topics_id_subject_user UNIQUE (id, subject_id, user_id),
    -- Database-level constraint: parent topic MUST belong to the exact same subject and user
    CONSTRAINT fk_topics_parent FOREIGN KEY (parent_topic_id, subject_id, user_id)
        REFERENCES public.topics(id, subject_id, user_id) ON DELETE CASCADE
);

-- Performance Indexes for topics
CREATE INDEX IF NOT EXISTS idx_topics_subject_id ON public.topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_topics_user_id ON public.topics(user_id);
CREATE INDEX IF NOT EXISTS idx_topics_parent_id ON public.topics(parent_topic_id);
CREATE INDEX IF NOT EXISTS idx_topics_level ON public.topics(hierarchy_level);

-- Enable RLS for topics
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

-- User Ownership Policies (Strict isolation per auth.uid(), idempotent)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'topics' AND policyname = 'Users can view own topics') THEN
        CREATE POLICY "Users can view own topics" ON public.topics FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'topics' AND policyname = 'Users can insert own topics') THEN
        CREATE POLICY "Users can insert own topics" ON public.topics FOR INSERT WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'topics' AND policyname = 'Users can update own topics') THEN
        CREATE POLICY "Users can update own topics" ON public.topics FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'topics' AND policyname = 'Users can delete own topics') THEN
        CREATE POLICY "Users can delete own topics" ON public.topics FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;

