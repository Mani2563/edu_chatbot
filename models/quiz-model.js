import crypto from 'crypto';
import { getSupabaseAdmin } from '../lib/supabase.js';

/**
 * QuizModel: Database model for Quiz Attempts, Questions, and Answers
 * Interacts with public.quiz_attempts, public.quiz_questions, public.quiz_question_keys, and public.quiz_answers
 * Enforces atomic transactions via PostgreSQL RPCs, zero answer-key leakage, and user isolation under Row Level Security (RLS)
 */

// In-memory fallback cache if PostgreSQL tables are pending migration in Supabase
const memoryStore = {
  attempts: new Map(),
  questions: new Map(), // Stores public.quiz_questions (WITHOUT correct_option or explanation)
  keys: new Map(),      // Stores public.quiz_question_keys (WITH correct_option and explanation)
  answers: new Map()
};

export const QuizModel = {
  /**
   * Save complete attempt, questions, and secure answer keys atomically
   */
  async saveAttemptWithQuestions(client, { attempt, questions }) {
    if (!attempt || !attempt.userId) {
      throw new Error('User ID is required to save quiz attempt');
    }

    const attemptRecord = {
      id: attempt.id || crypto.randomUUID(),
      user_id: attempt.userId,
      subject_id: attempt.subjectId,
      source_document_id: attempt.sourceDocumentId || null,
      chapter_id: attempt.chapterId || null,
      topic_id: attempt.topicId || null,
      scope: attempt.scope || 'topic',
      difficulty: attempt.difficulty,
      total_questions: questions.length,
      score: 0,
      percentage: 0.0,
      status: 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. Presentation Questions (Strictly NO correct_option or explanation)
    const questionRecords = questions.map((q, idx) => ({
      id: q.id || crypto.randomUUID(),
      attempt_id: attemptRecord.id,
      user_id: attempt.userId,
      question_order: q.questionOrder ?? idx + 1,
      question_text: q.questionText,
      options: q.options,
      difficulty: q.difficulty || attempt.difficulty,
      topic_id: q.topicId || attempt.topicId || null,
      chapter_id: q.chapterId || attempt.chapterId || null,
      source_document_id: attempt.sourceDocumentId || null,
      source_chunk_id: q.sourceChunkId || null,
      source_page_number: q.sourcePageNumber || null,
      citation_verified: Boolean(q.citationVerified),
      citation_snapshot: q.citationSnapshot || {
        chunkId: q.sourceChunkId,
        pageNumber: q.sourcePageNumber,
        verified: Boolean(q.citationVerified),
        verifiedAt: new Date().toISOString()
      },
      created_at: new Date().toISOString()
    }));

    // 2. Secret Answer Keys (Stored separately; strictly protected)
    const keyRecords = questions.map((q, idx) => ({
      id: crypto.randomUUID(),
      question_id: questionRecords[idx].id,
      attempt_id: attemptRecord.id,
      user_id: attempt.userId,
      correct_option: q.correctOption,
      explanation: q.explanation,
      created_at: new Date().toISOString()
    }));

    // Full specs for server-side service_role RPC
    const rpcQuestionPayloads = questions.map((q, idx) => ({
      id: questionRecords[idx].id,
      question_order: questionRecords[idx].question_order,
      question_text: questionRecords[idx].question_text,
      options: questionRecords[idx].options,
      correct_option: q.correctOption,
      explanation: q.explanation,
      difficulty: questionRecords[idx].difficulty,
      topic_id: questionRecords[idx].topic_id,
      chapter_id: questionRecords[idx].chapter_id,
      source_document_id: questionRecords[idx].source_document_id,
      source_chunk_id: questionRecords[idx].source_chunk_id,
      source_page_number: questionRecords[idx].source_page_number,
      citation_verified: questionRecords[idx].citation_verified,
      citation_snapshot: questionRecords[idx].citation_snapshot
    }));

    // 1. Try single PostgreSQL transaction via RPC (Uses trusted service_role)
    const adminClient = getSupabaseAdmin() || client;
    let dbError = null;

    if (adminClient) {
      try {
        const { data: rpcRes, error: rpcErr } = await adminClient.rpc('save_quiz_attempt', {
          p_attempt: attemptRecord,
          p_questions: rpcQuestionPayloads
        });

        if (!rpcErr && rpcRes?.success) {
          memoryStore.attempts.set(attemptRecord.id, attemptRecord);
          questionRecords.forEach(r => memoryStore.questions.set(r.id, r));
          keyRecords.forEach(k => memoryStore.keys.set(k.question_id, k));
          return { attempt: attemptRecord, questions: questionRecords };
        }
        if (rpcErr) dbError = rpcErr;
      } catch (e) {
        dbError = e;
      }

      // 2. Fallback to direct table writes (admin client) if RPC is missing
      try {
        const { error: attErr } = await adminClient
          .from('quiz_attempts')
          .insert(attemptRecord);

        if (!attErr) {
          const { error: qErr } = await adminClient
            .from('quiz_questions')
            .insert(questionRecords);

          const { error: kErr } = await adminClient
            .from('quiz_question_keys')
            .insert(keyRecords);

          if (!qErr) {
            memoryStore.attempts.set(attemptRecord.id, attemptRecord);
            questionRecords.forEach(r => memoryStore.questions.set(r.id, r));
            keyRecords.forEach(k => memoryStore.keys.set(k.question_id, k));
            return { attempt: attemptRecord, questions: questionRecords };
          }
        }
      } catch (e) {}

      // In production, failed database persistence must never be silently masked
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Production database persistence required: ${dbError?.message || 'Database insert failed'}`);
      }
    }

    // 3. Resilient development/testing memory store fallback (Only active when unmigrated in dev/test)
    memoryStore.attempts.set(attemptRecord.id, attemptRecord);
    questionRecords.forEach(r => memoryStore.questions.set(r.id, r));
    keyRecords.forEach(k => memoryStore.keys.set(k.question_id, k));
    return { attempt: attemptRecord, questions: questionRecords };
  },

  /**
   * Get attempt by ID and strictly verify user ownership
   */
  async getAttempt(client, attemptId, userId) {
    if (!attemptId || !userId) return null;

    if (client) {
      try {
        const { data, error } = await client
          .from('quiz_attempts')
          .select('*')
          .eq('id', attemptId)
          .eq('user_id', userId)
          .single();

        if (!error && data) return data;
      } catch (err) {}
    }

    const cached = memoryStore.attempts.get(attemptId);
    if (cached && cached.user_id === userId) {
      return cached;
    }
    return null;
  },

  /**
   * Get presentation questions for an attempt (STRICTLY NO answer keys or explanations)
   */
  async getQuestionsForAttempt(client, attemptId, userId) {
    if (!attemptId || !userId) return [];

    if (client) {
      try {
        const { data, error } = await client
          .from('quiz_questions')
          .select('*')
          .eq('attempt_id', attemptId)
          .eq('user_id', userId)
          .order('question_order', { ascending: true });

        if (!error && data && data.length > 0) return data;
      } catch (err) {}
    }

    const matches = [];
    for (const q of memoryStore.questions.values()) {
      if (q.attempt_id === attemptId && q.user_id === userId) {
        matches.push(q);
      }
    }
    return matches.sort((a, b) => a.question_order - b.question_order);
  },

  /**
   * Trusted Server-Side Helper: Get secret answer keys (Accessible only to backend)
   */
  async getAnswerKeys(client, attemptId, userId) {
    if (!attemptId || !userId) return [];

    const adminClient = getSupabaseAdmin() || client;
    if (adminClient) {
      try {
        const { data, error } = await adminClient
          .from('quiz_question_keys')
          .select('*')
          .eq('attempt_id', attemptId)
          .eq('user_id', userId);

        if (!error && data && data.length > 0) return data;
      } catch (err) {}
    }

    const keys = [];
    for (const k of memoryStore.keys.values()) {
      if (k.attempt_id === attemptId && k.user_id === userId) {
        keys.push(k);
      }
    }
    return keys;
  },

  /**
   * Submit student answers, verify completed lock, calculate score server-side, and persist
   */
  async submitAttempt(client, { attemptId, userId, answers, score, percentage }) {
    if (!attemptId || !userId) {
      throw new Error('Attempt ID and User ID are required');
    }

    // Double-check attempt exists and is not already completed
    const existing = await this.getAttempt(client, attemptId, userId);
    if (!existing) {
      throw new Error('Quiz attempt not found or access denied');
    }
    if (existing.status === 'completed') {
      throw new Error('This quiz attempt has already been submitted and completed. Resubmission is prohibited.');
    }
    if (existing.status === 'abandoned') {
      throw new Error('This quiz attempt has been abandoned. Submitting an abandoned attempt is prohibited.');
    }
    if (existing.status !== 'in_progress') {
      throw new Error(`Cannot submit quiz attempt in ${existing.status} status (only in_progress attempts can be submitted)`);
    }

    const answerRecords = answers.map(a => ({
      id: crypto.randomUUID(),
      attempt_id: attemptId,
      question_id: a.questionId,
      user_id: userId,
      selected_option: a.selectedOption,
      is_correct: Boolean(a.isCorrect),
      answered_at: new Date().toISOString()
    }));

    const completedAt = new Date().toISOString();

    // 1. Try PostgreSQL RPC transaction (Calculates score & percentage strictly in DB using quiz_question_keys)
    if (client) {
      try {
        const sanitizedAnswers = answers.map(a => ({
          question_id: a.questionId,
          selected_option: a.selectedOption
        }));

        const { data: rpcRes, error: rpcErr } = await client.rpc('submit_quiz_attempt', {
          p_attempt_id: attemptId,
          p_answers: sanitizedAnswers
        });

        if (!rpcErr && rpcRes?.success) {
          answerRecords.forEach(ar => memoryStore.answers.set(`${attemptId}:${ar.question_id}`, ar));
          existing.status = 'completed';
          existing.score = rpcRes.score;
          existing.percentage = rpcRes.percentage;
          existing.completed_at = rpcRes.completed_at || completedAt;
          memoryStore.attempts.set(attemptId, existing);
          return {
            ...existing,
            evaluated_answers: rpcRes.evaluated_answers
          };
        }
      } catch (e) {}

      // 2. Direct table update fallback (using trusted admin client)
      try {
        const adminClient = getSupabaseAdmin() || client;
        const { error: ansErr } = await adminClient
          .from('quiz_answers')
          .insert(answerRecords);

        const { data: updated, error: attErr } = await adminClient
          .from('quiz_attempts')
          .update({
            score,
            percentage,
            status: 'completed',
            completed_at: completedAt,
            updated_at: completedAt
          })
          .eq('id', attemptId)
          .eq('user_id', userId)
          .eq('status', 'in_progress') // Optimistic concurrency lock
          .select()
          .single();

        if (!ansErr && !attErr && updated) {
          answerRecords.forEach(ar => memoryStore.answers.set(`${attemptId}:${ar.question_id}`, ar));
          memoryStore.attempts.set(attemptId, updated);
          return updated;
        }
      } catch (e) {}

      // In production, failed database submission must never be silently masked
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Production database submission required: RPC and table write failed');
      }
    }

    // 3. Resilient memory store update
    answerRecords.forEach(ar => memoryStore.answers.set(`${attemptId}:${ar.question_id}`, ar));
    existing.status = 'completed';
    existing.score = score;
    existing.percentage = percentage;
    existing.completed_at = completedAt;
    existing.updated_at = completedAt;
    memoryStore.attempts.set(attemptId, existing);

    return existing;
  },

  /**
   * Get full verified review for a COMPLETED quiz attempt
   * Rejects in-progress attempts; includes questions, student answers, correct keys, explanations, and citations.
   */
  async getAttemptReview(client, attemptId, userId) {
    if (!attemptId || !userId) {
      throw new Error('Attempt ID and User ID are required');
    }

    const attempt = await this.getAttempt(client, attemptId, userId);
    if (!attempt) {
      throw new Error('Quiz attempt not found or access denied');
    }
    if (attempt.status !== 'completed') {
      throw new Error('Quiz attempt is still in progress. Review is only accessible after completion.');
    }

    // 1. Try get_quiz_attempt_review RPC
    if (client) {
      try {
        const { data: rpcRes, error: rpcErr } = await client.rpc('get_quiz_attempt_review', {
          p_attempt_id: attemptId
        });

        if (!rpcErr && rpcRes?.success) {
          return rpcRes;
        }
      } catch (e) {}

      // 2. Try querying quiz_attempt_reviews view
      try {
        const { data: viewData, error: viewErr } = await client
          .from('quiz_attempt_reviews')
          .select('*')
          .eq('attempt_id', attemptId)
          .eq('user_id', userId)
          .order('question_order', { ascending: true });

        if (!viewErr && viewData && viewData.length > 0) {
          const reviewItems = viewData.map(v => ({
            questionId: v.question_id,
            questionOrder: v.question_order,
            questionText: v.question_text,
            options: v.options,
            difficulty: v.difficulty,
            topicId: v.topic_id || attempt.topic_id || null,
            chapterId: v.chapter_id || attempt.chapter_id || null,
            selectedOption: v.selected_option,
            correctOption: v.correct_option,
            isCorrect: Boolean(v.is_correct),
            explanation: v.explanation,
            sourceReference: {
              chunkId: v.source_chunk_id,
              pageNumber: v.source_page_number,
              verified: v.citation_verified,
              citationSnapshot: v.citation_snapshot
            }
          }));

          return {
            success: true,
            attempt,
            review: reviewItems
          };
        }
      } catch (e) {}
    }

    // 3. Fallback from in-memory store (Only active in dev/test when tables are unmigrated)
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Production database review query required: attempt ${attemptId} not found in database`);
    }

    const questions = await this.getQuestionsForAttempt(client, attemptId, userId);
    const keys = await this.getAnswerKeys(client, attemptId, userId);
    const keyMap = new Map();
    keys.forEach(k => keyMap.set(k.question_id, k));

    const reviewItems = questions.map(q => {
      const ansKey = `${attemptId}:${q.id}`;
      const ans = memoryStore.answers.get(ansKey);
      const secret = keyMap.get(q.id) || {};
      const snapshot = q.citation_snapshot || {};

      return {
        questionId: q.id,
        questionOrder: q.question_order,
        questionText: q.question_text,
        options: q.options,
        difficulty: q.difficulty,
        topicId: q.topic_id || attempt.topic_id || null,
        chapterId: q.chapter_id || attempt.chapter_id || null,
        selectedOption: ans?.selected_option || null,
        correctOption: secret.correct_option || null,
        isCorrect: Boolean(ans?.is_correct),
        explanation: secret.explanation || '',
        sourceReference: {
          chunkId: q.source_chunk_id,
          pageNumber: q.source_page_number || snapshot.pageNumber || null,
          fileName: snapshot.fileName || null,
          verified: q.citation_verified,
          citationSnapshot: snapshot
        }
      };
    });

    return {
      success: true,
      attempt,
      review: reviewItems
    };
  },

  /**
   * Get student's quiz attempt history
   */
  async getHistory(client, userId, options = {}) {
    if (!userId) return [];
    const { subjectId, topicId, limit = 20 } = options;

    if (client) {
      try {
        let query = client
          .from('quiz_attempts')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (subjectId) query = query.eq('subject_id', subjectId);
        if (topicId) query = query.eq('topic_id', topicId);

        const { data, error } = await query;
        if (!error && data) return data;
      } catch (err) {}
    }

    const list = [];
    for (const a of memoryStore.attempts.values()) {
      if (a.user_id === userId) {
        if (subjectId && a.subject_id !== subjectId) continue;
        if (topicId && a.topic_id !== topicId) continue;
        list.push(a);
      }
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }
};
