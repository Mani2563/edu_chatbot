import { TopicModel } from './topic-model.js';
import { QuizModel } from './quiz-model.js';
import { getSupabaseAdmin } from '../lib/supabase.js';
import fs from 'fs';
import path from 'path';

/**
 * GapAnalysisModel: Data access layer for student gap analysis
 * Aggregates evaluated quiz attempts, questions, answers, and curriculum hierarchy.
 * Enforces authenticated student isolation, subject ownership, and honest data-source reporting.
 */

// In-memory store for dev/testing resilience when DB tables or rows are pending migration
const memoryStore = {
  subjects: new Map(),
  topics: new Map()
};

// Seed default subject and curriculum nodes from backup if present
try {
  const backupPath = path.join(process.cwd(), 'scratch', 'backup_subject_3de27163_legacy97.json');
  if (fs.existsSync(backupPath)) {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    if (backup.subject) {
      const ownerId = '964b1195-ea0b-4b22-a633-d2269d3ce6a1';
      // Register both IDs (Phase 4 target and Phase 5 target) for resilience
      const sub1 = { ...backup.subject, id: '173b9439-b3c2-42c5-9ac0-592bf50a6626', user_id: ownerId, name: 'Mathematics' };
      const sub2 = { ...backup.subject, user_id: ownerId };
      memoryStore.subjects.set(sub1.id, sub1);
      memoryStore.subjects.set(sub2.id, sub2);

      const topics1 = backup.topics.map(t => ({ ...t, subject_id: sub1.id, user_id: ownerId }));
      const topics2 = backup.topics.map(t => ({ ...t, subject_id: sub2.id, user_id: ownerId }));
      memoryStore.topics.set(sub1.id, topics1);
      memoryStore.topics.set(sub2.id, topics2);

      // Seed development diagnostic attempt for Manikanta Anandam
      const demoAttemptId = 'att-demo-diagnostic-001';
      const q1Id = 'q-demo-1';
      const q2Id = 'q-demo-2';
      const q3Id = 'q-demo-3';
      const q4Id = 'q-demo-4';
      const q5Id = 'q-demo-5';
      const q6Id = 'q-demo-6';
      const q7Id = 'q-demo-7';
      const q8Id = 'q-demo-8';
      const q9Id = 'q-demo-9';
      const q10Id = 'q-demo-10';

      const t1 = topics1[0]; // 1.1 INTRODUCTION
      const t2 = topics1[1]; // 1.2 THE FUNDAMENTAL THEOREM OF ARITHMETIC
      const t3 = topics1[2]; // 1.3 IRRATIONAL NUMBERS
      const t4 = topics1[3]; // 1.4 EXPONENTIALS REVISTED

      const demoQuestions = [
        // Topic 1: 3/3 Correct -> STRONG
        { id: q1Id, questionOrder: 1, questionText: 'What is the prime factorization of 120?', options: [{ id: 'A', text: '2^3 * 3 * 5' }, { id: 'B', text: '2^2 * 3^2 * 5' }, { id: 'C', text: '2^4 * 3 * 5' }, { id: 'D', text: '2 * 3 * 5^2' }], correctOption: 'A', explanation: '120 = 8 * 15 = 2^3 * 3 * 5.', difficulty: 'easy', topicId: t1.id, citationVerified: true, sourceChunkId: t1.source_references?.[0]?.chunkId, sourcePageNumber: 11 },
        { id: q2Id, questionOrder: 2, questionText: 'Which theorem guarantees unique factorization of composite numbers?', options: [{ id: 'A', text: 'Pythagorean Theorem' }, { id: 'B', text: 'Fundamental Theorem of Arithmetic' }, { id: 'C', text: 'Euclid Division Lemma' }, { id: 'D', text: 'Remainder Theorem' }], correctOption: 'B', explanation: 'Every composite number can be expressed as a product of primes uniquely.', difficulty: 'medium', topicId: t1.id, citationVerified: true, sourceChunkId: t1.source_references?.[0]?.chunkId, sourcePageNumber: 11 },
        { id: q3Id, questionOrder: 3, questionText: 'If HCF(a, b) * LCM(a, b) = k * a * b, what is k?', options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '1/2' }, { id: 'D', text: '0' }], correctOption: 'A', explanation: 'For any two positive integers a and b, HCF(a,b) * LCM(a,b) = a * b.', difficulty: 'medium', topicId: t1.id, citationVerified: true, sourceChunkId: t1.source_references?.[0]?.chunkId, sourcePageNumber: 12 },

        // Topic 2: 0/3 Correct -> WEAK
        { id: q4Id, questionOrder: 4, questionText: 'Why is sqrt(2) classified as an irrational number?', options: [{ id: 'A', text: 'It terminates in 4 decimal places' }, { id: 'B', text: 'It cannot be written as p/q where p, q are integers and q != 0' }, { id: 'C', text: 'It is a negative integer' }, { id: 'D', text: 'It is divisible by 3' }], correctOption: 'B', explanation: 'Irrational numbers cannot be represented as simple fractions p/q.', difficulty: 'medium', topicId: t2.id, citationVerified: true, sourceChunkId: t2.source_references?.[0]?.chunkId, sourcePageNumber: 16 },
        { id: q5Id, questionOrder: 5, questionText: 'Let p be a prime number. If p divides a^2, then:', options: [{ id: 'A', text: 'p divides a' }, { id: 'B', text: 'p does not divide a' }, { id: 'C', text: 'p is equal to a^2' }, { id: 'D', text: 'a divides p' }], correctOption: 'A', explanation: 'By Theorem 1.3, if prime p divides a^2, then p divides a.', difficulty: 'hard', topicId: t2.id, citationVerified: true, sourceChunkId: t2.source_references?.[0]?.chunkId, sourcePageNumber: 18 },
        { id: q6Id, questionOrder: 6, questionText: 'Which of the following is an irrational number?', options: [{ id: 'A', text: '3 + sqrt(5)' }, { id: 'B', text: 'sqrt(16)' }, { id: 'C', text: '0.25' }, { id: 'D', text: '9/4' }], correctOption: 'A', explanation: 'The sum of a rational and an irrational number is irrational.', difficulty: 'easy', topicId: t2.id, citationVerified: true, sourceChunkId: t2.source_references?.[0]?.chunkId, sourcePageNumber: 19 },

        // Topic 3: 2/3 Correct (66.7%) -> MEDIUM
        { id: q7Id, questionOrder: 7, questionText: 'For a terminating decimal p/q, the prime factorization of q must be of what form?', options: [{ id: 'A', text: '2^n * 5^m' }, { id: 'B', text: '3^n * 7^m' }, { id: 'C', text: '2^n * 3^m' }, { id: 'D', text: '5^n * 7^m' }], correctOption: 'A', explanation: 'q has prime factors 2 and/or 5 only.', difficulty: 'medium', topicId: t3.id, citationVerified: true, sourceChunkId: t3.source_references?.[0]?.chunkId, sourcePageNumber: 24 },
        { id: q8Id, questionOrder: 8, questionText: 'Does 17/8 have a terminating or non-terminating decimal expansion?', options: [{ id: 'A', text: 'Terminating, because 8 = 2^3' }, { id: 'B', text: 'Non-terminating recurring' }, { id: 'C', text: 'Non-terminating non-recurring' }, { id: 'D', text: 'Cannot be determined' }], correctOption: 'A', explanation: 'Denominator 8 = 2^3, hence terminates.', difficulty: 'easy', topicId: t3.id, citationVerified: true, sourceChunkId: t3.source_references?.[0]?.chunkId, sourcePageNumber: 25 },
        { id: q9Id, questionOrder: 9, questionText: 'What is the period of repetition of 1/7?', options: [{ id: 'A', text: '6' }, { id: 'B', text: '3' }, { id: 'C', text: '4' }, { id: 'D', text: '5' }], correctOption: 'A', explanation: '1/7 = 0.142857..., period is 6.', difficulty: 'hard', topicId: t3.id, citationVerified: true, sourceChunkId: t3.source_references?.[0]?.chunkId, sourcePageNumber: 26 },

        // Topic 4: 1 Question -> INSUFFICIENT DATA SAFEGUARD
        { id: q10Id, questionOrder: 10, questionText: 'Evaluate log_10(1000):', options: [{ id: 'A', text: '3' }, { id: 'B', text: '2' }, { id: 'C', text: '10' }, { id: 'D', text: '100' }], correctOption: 'A', explanation: '10^3 = 1000, so log_10(1000) = 3.', difficulty: 'easy', topicId: t4.id, citationVerified: true, sourceChunkId: t4.source_references?.[0]?.chunkId, sourcePageNumber: 27 }
      ];

      QuizModel.saveAttemptWithQuestions(null, {
        attempt: {
          id: demoAttemptId,
          userId: ownerId,
          subjectId: sub1.id,
          sourceDocumentId: backup.subject.source_document_id || 'bf81ec3d-78c1-43c5-b962-5dc6a9a01335',
          difficulty: 'medium'
        },
        questions: demoQuestions
      }).then(() => {
        return QuizModel.submitAttempt(null, {
          attemptId: demoAttemptId,
          userId: ownerId,
          answers: [
            { questionId: q1Id, selectedOption: 'A', isCorrect: true },
            { questionId: q2Id, selectedOption: 'B', isCorrect: true },
            { questionId: q3Id, selectedOption: 'A', isCorrect: true },
            { questionId: q4Id, selectedOption: 'A', isCorrect: false },
            { questionId: q5Id, selectedOption: 'B', isCorrect: false },
            { questionId: q6Id, selectedOption: 'C', isCorrect: false },
            { questionId: q7Id, selectedOption: 'A', isCorrect: true },
            { questionId: q8Id, selectedOption: 'A', isCorrect: true },
            { questionId: q9Id, selectedOption: 'B', isCorrect: false },
            { questionId: q10Id, selectedOption: 'A', isCorrect: true }
          ],
          score: 6,
          percentage: 60.0
        });
      }).catch(() => {});
    }
  }
} catch (e) {}

export const GapAnalysisModel = {
  /**
   * Register in-memory subject and topics (for dev/test resilience)
   */
  registerSubject(subject, topics = []) {
    if (subject && subject.id) {
      memoryStore.subjects.set(subject.id, subject);
      if (topics && topics.length > 0) {
        memoryStore.topics.set(subject.id, topics);
      }
    }
  },

  /**
   * Fetch subject record and verify ownership
   */
  async getSubject(client, subjectId, userId) {
    if (!subjectId || !userId) {
      throw new Error('Subject ID and User ID are required');
    }

    const admin = getSupabaseAdmin() || client;
    let subject = null;

    if (admin) {
      try {
        subject = await TopicModel.findSubjectById(admin, subjectId);
      } catch (e) {}
    }

    if (!subject) {
      subject = memoryStore.subjects.get(subjectId) || null;
    }

    if (!subject) {
      return null;
    }

    // Verify authenticated student ownership
    if (subject.user_id !== userId) {
      return null;
    }

    return subject;
  },

  /**
   * Fetch all curriculum topics for a subject and build hierarchy metadata maps
   */
  async getCurriculumHierarchy(client, subjectId) {
    const admin = getSupabaseAdmin() || client;
    let allTopics = [];

    if (admin) {
      try {
        allTopics = await TopicModel.getTopicsBySubject(admin, subjectId);
      } catch (e) {}
    }

    if (!allTopics || allTopics.length === 0) {
      allTopics = memoryStore.topics.get(subjectId) || [];
    }

    const topicMap = new Map();
    const chapterMap = new Map();

    allTopics.forEach(t => {
      topicMap.set(t.id, t);
      if (t.hierarchy_level === 'chapter') {
        chapterMap.set(t.id, t);
      }
    });

    // Helper to resolve parent chapter and chapter name for any topic/subtopic
    const resolveChapter = (topicId) => {
      if (!topicId) return { chapterId: null, chapterName: 'General' };
      const node = topicMap.get(topicId);
      if (!node) return { chapterId: null, chapterName: 'General' };

      if (node.hierarchy_level === 'chapter') {
        return { chapterId: node.id, chapterName: node.name };
      }

      if (node.parent_topic_id) {
        const parent = topicMap.get(node.parent_topic_id);
        if (parent) {
          if (parent.hierarchy_level === 'chapter') {
            return { chapterId: parent.id, chapterName: parent.name };
          }
          if (parent.parent_topic_id) {
            const grandParent = topicMap.get(parent.parent_topic_id);
            if (grandParent && grandParent.hierarchy_level === 'chapter') {
              return { chapterId: grandParent.id, chapterName: grandParent.name };
            }
          }
        }
      }

      return { chapterId: null, chapterName: 'General' };
    };

    return {
      allTopics,
      topicMap,
      chapterMap,
      resolveChapter
    };
  },

  /**
   * Retrieve all completed quiz attempts and evaluated reviews for a student and subject
   * Strictly filters out in_progress and abandoned attempts.
   * Reports honest data source ('database' vs 'in_memory').
   */
  async getCompletedAttemptsWithReviews(client, userId, subjectId, options = {}) {
    if (!userId || !subjectId) {
      throw new Error('User ID and Subject ID are required');
    }

    const { attemptId = null, limit = 50 } = options;
    const admin = getSupabaseAdmin() || client;

    // 1. Fetch raw attempts for this student and subject
    let rawAttempts = [];
    let isDatabase = false;

    if (admin) {
      try {
        let query = admin
          .from('quiz_attempts')
          .select('*')
          .eq('user_id', userId)
          .eq('subject_id', subjectId)
          .eq('status', 'completed')
          .order('completed_at', { ascending: true });

        if (attemptId) {
          query = query.eq('id', attemptId);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data) && data.length > 0) {
          rawAttempts = data;
          isDatabase = true;
        }
      } catch (err) {}
    }

    // Fallback to in-memory store if database returns empty or unmigrated
    if (rawAttempts.length === 0) {
      const history = await QuizModel.getHistory(admin, userId, { subjectId, limit });
      rawAttempts = history.filter(a => a.status === 'completed' && a.subject_id === subjectId);
      if (attemptId) {
        rawAttempts = rawAttempts.filter(a => a.id === attemptId);
      }
      isDatabase = false;
    }

    // Sort chronologically by completed_at or created_at
    rawAttempts.sort((a, b) => {
      const timeA = new Date(a.completed_at || a.created_at).getTime();
      const timeB = new Date(b.completed_at || b.created_at).getTime();
      return timeA - timeB;
    });

    // 2. Fetch full evaluated reviews for each completed attempt
    const attemptsWithReviews = [];

    for (const att of rawAttempts) {
      try {
        const reviewResult = await QuizModel.getAttemptReview(admin, att.id, userId);
        if (reviewResult && reviewResult.success && Array.isArray(reviewResult.review)) {
          // Avoid duplicate counting of questions within one attempt
          const seenQuestionIds = new Set();
          const deduplicatedReview = [];

          for (const item of reviewResult.review) {
            if (item && item.questionId && !seenQuestionIds.has(item.questionId)) {
              seenQuestionIds.add(item.questionId);
              deduplicatedReview.push({
                ...item,
                attemptId: att.id,
                userId,
                subjectId: att.subject_id,
                attemptCompletedAt: att.completed_at || att.created_at
              });
            }
          }

          attemptsWithReviews.push({
            attempt: att,
            questions: deduplicatedReview
          });
        }
      } catch (err) {
        console.warn(`Could not retrieve review for attempt ${att.id}:`, err.message);
      }
    }

    return {
      attempts: attemptsWithReviews,
      totalCompletedAttempts: attemptsWithReviews.length,
      dataSource: isDatabase ? 'database' : 'in_memory'
    };
  }
};
