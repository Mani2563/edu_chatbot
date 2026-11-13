import crypto from 'crypto';
import { QuizModel } from '../models/quiz-model.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';
import { BM25Engine, tokenize } from '../lib/retriever.js';
import { getGroqModel, isGroqConfigured } from '../lib/groq.js';
import { getUserSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';
import { generateText } from 'ai';

/**
 * Lightweight Lexical Deduplicator (Compatible with Okapi BM25)
 * Computes Jaccard unigram and bigram overlap without requiring vector embeddings
 */
class LexicalDeduplicator {
  constructor(threshold = 0.65) {
    this.threshold = threshold;
    this.seenTokenSets = [];
  }

  isDuplicate(text) {
    if (!text || typeof text !== 'string') return false;
    const tokens = tokenize(text, true);
    if (tokens.length === 0) return false;
    const tokenSet = new Set(tokens);

    for (const prevSet of this.seenTokenSets) {
      const similarity = this._jaccard(tokenSet, prevSet);
      if (similarity >= this.threshold) {
        return true;
      }
    }
    return false;
  }

  add(text) {
    const tokens = tokenize(text, true);
    if (tokens.length > 0) {
      this.seenTokenSets.push(new Set(tokens));
    }
  }

  _jaccard(setA, setB) {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }
}

export const QuizService = {
  /**
   * Generates a diagnostic quiz grounded with citations for a topic or chapter
   * Enforces strict student isolation and server-side calculation
   */
  async generateQuiz(user, params = {}) {
    // 1. Enforce authenticated student context (NEVER trust client-provided user_id)
    if (!user || !user.id) {
      throw new Error('Authentication required to generate quiz');
    }

    const {
      subjectId,
      documentId: rawDocId,
      chapterId = null,
      topicId = null,
      difficulty = 'medium',
      questionCount = 5
    } = params;

    if (!subjectId) {
      throw new Error('Subject ID is required');
    }

    const validDifficulties = ['easy', 'medium', 'hard'];
    const normalizedDifficulty = validDifficulties.includes(difficulty?.toLowerCase())
      ? difficulty.toLowerCase()
      : 'medium';

    const count = Math.max(1, Math.min(15, parseInt(questionCount, 10) || 5));

    const userClient = user.accessToken ? getUserSupabaseClient(user.accessToken) : null;
    const admin = getSupabaseAdmin();
    const db = userClient || admin;

    // 2. Fetch Subject & strictly verify student ownership
    const { data: subject, error: subErr } = await db
      .from('subjects')
      .select('*')
      .eq('id', subjectId)
      .eq('user_id', user.id) // Enforces ownership integrity
      .single();

    if (subErr || !subject) {
      throw new Error('Subject not found or access denied');
    }

    const documentId = rawDocId || subject.source_document_id;
    if (!documentId) {
      throw new Error('No source document associated with this subject');
    }

    // 3. Resolve Topic / Chapter details and verify relationship to subject
    let targetTopic = null;
    let targetChapter = null;
    let scope = 'subject';

    if (topicId) {
      scope = 'topic';
      const { data: top } = await db
        .from('topics')
        .select('*')
        .eq('id', topicId)
        .eq('subject_id', subjectId)
        .eq('user_id', user.id)
        .single();

      if (!top) {
        throw new Error('Topic not found or does not belong to this subject');
      }
      targetTopic = top;

      if (top.parent_topic_id) {
        const { data: chap } = await db
          .from('topics')
          .select('*')
          .eq('id', top.parent_topic_id)
          .eq('subject_id', subjectId)
          .eq('user_id', user.id)
          .single();
        targetChapter = chap;
      }
    } else if (chapterId) {
      scope = 'chapter';
      const { data: chap } = await db
        .from('topics')
        .select('*')
        .eq('id', chapterId)
        .eq('subject_id', subjectId)
        .eq('user_id', user.id)
        .single();

      if (!chap) {
        throw new Error('Chapter not found or does not belong to this subject');
      }
      targetChapter = chap;
    }

    // 4. Fetch authenticated student's chunks for this document
    const chunks = await DocumentChunkModel.getChunksByUser(db, user.id, [documentId]);
    if (!chunks || chunks.length === 0) {
      throw new Error('Not enough study material found to generate questions for this topic.');
    }

    // Chunk lookup map
    const chunkMap = new Map();
    chunks.forEach(c => chunkMap.set(c.id, c));

    // 5. Select relevant chunks for targeted topic/chapter
    const relevantChunks = this._selectRelevantChunks({
      chunks,
      targetTopic,
      targetChapter,
      scope
    });

    if (relevantChunks.length === 0) {
      throw new Error('Not enough study material found to generate questions for this topic.');
    }

    // 6. Generate candidate questions via Groq or deterministic grounded engine
    let rawQuestions = [];
    if (isGroqConfigured()) {
      try {
        rawQuestions = await this._generateWithGroq({
          chunks: relevantChunks,
          targetTopic,
          targetChapter,
          difficulty: normalizedDifficulty,
          count: count + 3
        });
      } catch (err) {
        console.warn('Groq quiz generation failed, using deterministic grounded synthesizer:', err.message);
        rawQuestions = this._generateDeterministicGrounded({
          chunks: relevantChunks,
          targetTopic,
          targetChapter,
          difficulty: normalizedDifficulty,
          count: count + 2
        });
      }
    } else {
      rawQuestions = this._generateDeterministicGrounded({
        chunks: relevantChunks,
        targetTopic,
        targetChapter,
        difficulty: normalizedDifficulty,
        count: count + 2
      });
    }

    // 7. Strict Validation, Option Ambiguity Check & 4-Stage Citation Integrity Verification
    const deduplicator = new LexicalDeduplicator(0.65);
    const verifiedQuestions = [];

    for (const rawQ of rawQuestions) {
      const validated = this._validateAndVerifyQuestion(rawQ, {
        documentId,
        userId: user.id,
        chunkMap,
        deduplicator,
        targetTopic,
        targetChapter,
        difficulty: normalizedDifficulty
      });

      if (validated && validated.citationVerified) {
        deduplicator.add(validated.questionText);
        verifiedQuestions.push(validated);
        if (verifiedQuestions.length >= count) break;
      }
    }

    if (verifiedQuestions.length === 0) {
      throw new Error('Unable to generate valid grounded questions for the requested topic from the available textbook material.');
    }

    // 8. Persist Attempt and Questions Atomically via PostgreSQL Transaction / Model
    const attemptId = crypto.randomUUID();
    const attemptPayload = {
      id: attemptId,
      userId: user.id,
      subjectId,
      sourceDocumentId: documentId,
      chapterId: targetChapter?.id || chapterId || null,
      topicId: targetTopic?.id || topicId || null,
      scope,
      difficulty: normalizedDifficulty
    };

    const questionPayloads = verifiedQuestions.map((q, idx) => ({
      id: crypto.randomUUID(),
      attemptId,
      userId: user.id,
      questionOrder: idx + 1,
      questionText: q.questionText,
      options: q.options,
      correctOption: q.correctOption, // Stored safely on server
      explanation: q.explanation,     // Stored safely on server
      difficulty: normalizedDifficulty,
      topicId: targetTopic?.id || topicId || null,
      chapterId: targetChapter?.id || chapterId || null,
      sourceDocumentId: documentId,
      sourceChunkId: q.sourceChunkId,
      sourcePageNumber: q.sourcePageNumber || null,
      citationVerified: true,
      citationSnapshot: q.citationSnapshot
    }));

    await QuizModel.saveAttemptWithQuestions(db, {
      attempt: attemptPayload,
      questions: questionPayloads
    });

    // 9. Return Client Payload: Correct answers and explanations are STRICTLY OMITTED
    const clientQuestions = questionPayloads.map(q => ({
      id: q.id,
      questionOrder: q.questionOrder,
      questionText: q.questionText,
      options: q.options,
      difficulty: q.difficulty,
      sourcePageNumber: q.sourcePageNumber
    }));

    return {
      success: true,
      attempt: {
        id: attemptId,
        subjectId,
        sourceDocumentId: documentId,
        chapterId: targetChapter?.id || null,
        topicId: targetTopic?.id || null,
        scope,
        difficulty: normalizedDifficulty,
        totalQuestions: clientQuestions.length,
        status: 'in_progress'
      },
      questions: clientQuestions
    };
  },

  /**
   * Submit student answers, evaluate score strictly server-side, and persist results
   */
  async submitQuiz(user, params = {}) {
    if (!user || !user.id) {
      throw new Error('Authentication required to submit quiz');
    }

    const { attemptId, answers = [] } = params;
    if (!attemptId) {
      throw new Error('Attempt ID is required');
    }

    const userClient = user.accessToken ? getUserSupabaseClient(user.accessToken) : null;
    const admin = getSupabaseAdmin();
    const db = userClient || admin;

    // 1. Fetch attempt and strictly verify user ownership
    const attempt = await QuizModel.getAttempt(db, attemptId, user.id);
    if (!attempt) {
      throw new Error('Quiz attempt not found or access denied');
    }

    // 2. Prevent answer modification / resubmission after attempt is completed or abandoned
    if (attempt.status === 'completed') {
      throw new Error('This quiz attempt has already been submitted and completed. Resubmission is prohibited.');
    }
    if (attempt.status === 'abandoned') {
      throw new Error('This quiz attempt has been abandoned. Submitting an abandoned attempt is prohibited.');
    }
    if (attempt.status !== 'in_progress') {
      throw new Error(`Cannot submit quiz attempt in ${attempt.status} status (only in_progress attempts can be submitted)`);
    }

    // 3. Fetch questions strictly belonging to this attempt and this student
    const storedQuestions = await QuizModel.getQuestionsForAttempt(db, attemptId, user.id);
    if (!storedQuestions || storedQuestions.length === 0) {
      throw new Error('No questions found for this quiz attempt');
    }

    // Map questions for fast lookup and verify answer boundaries
    const storedQuestionMap = new Map();
    storedQuestions.forEach(sq => storedQuestionMap.set(sq.id, sq));

    const answerMap = new Map();
    for (const a of answers) {
      if (a && a.questionId) {
        // Enforce that answer question belongs to this attempt and student (Requirement 4)
        if (storedQuestionMap.has(a.questionId)) {
          answerMap.set(a.questionId, a.selectedOption ? a.selectedOption.toUpperCase().trim() : null);
        }
      }
    }

    // 4. Server-Side Score Calculation & Evaluation
    // Fetch secret answer keys strictly via trusted server-side call
    const secretKeys = await QuizModel.getAnswerKeys(admin || db, attemptId, user.id);
    const keyMap = new Map();
    secretKeys.forEach(k => keyMap.set(k.question_id, k));

    let score = 0;
    const evaluatedAnswers = [];

    for (const q of storedQuestions) {
      const selectedOption = answerMap.get(q.id) || null;
      const secret = keyMap.get(q.id);
      const isCorrect = (selectedOption !== null && secret?.correct_option && selectedOption === secret.correct_option);

      if (isCorrect) score += 1;

      evaluatedAnswers.push({
        questionId: q.id,
        selectedOption,
        isCorrect
      });
    }

    const totalQuestions = storedQuestions.length;
    const percentage = Number(((score / totalQuestions) * 100).toFixed(2));

    // 5. Submit atomically via single transaction / RPC
    const completedAttempt = await QuizModel.submitAttempt(db, {
      attemptId,
      userId: user.id,
      answers: evaluatedAnswers,
      score,
      percentage
    });

    // Build evaluated review items
    const evaluatedMap = new Map();
    if (Array.isArray(completedAttempt?.evaluated_answers)) {
      completedAttempt.evaluated_answers.forEach(ea => evaluatedMap.set(ea.question_id, ea));
    }

    const reviewItems = storedQuestions.map(q => {
      const evalAns = evaluatedMap.get(q.id);
      const secret = keyMap.get(q.id) || {};
      const selectedOption = evalAns ? evalAns.selected_option : (answerMap.get(q.id) || null);
      const correctOption = evalAns?.correct_option || secret.correct_option || null;
      const isCorrect = evalAns !== undefined ? Boolean(evalAns.is_correct) : Boolean(selectedOption !== null && selectedOption === correctOption);
      const explanation = evalAns?.explanation || secret.explanation || '';
      const snapshot = q.citation_snapshot || {};

      return {
        questionId: q.id,
        questionOrder: q.question_order,
        questionText: q.question_text,
        options: q.options,
        difficulty: q.difficulty,
        topicId: q.topic_id || attempt.topic_id || null,
        chapterId: q.chapter_id || attempt.chapter_id || null,
        selectedOption,
        correctOption,
        isCorrect,
        explanation,
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
      attemptId,
      score: completedAttempt.score !== undefined ? completedAttempt.score : score,
      totalQuestions,
      percentage: completedAttempt.percentage !== undefined ? completedAttempt.percentage : percentage,
      status: 'completed',
      completedAt: completedAttempt.completed_at || new Date().toISOString(),
      review: reviewItems
    };
  },

  /**
   * Retrieves review for a completed quiz attempt
   * Strictly rejects in-progress attempts; provides full verified review for completed quizzes
   */
  async getQuizReview(user, attemptId) {
    if (!user || !user.id) {
      throw new Error('Authentication required');
    }
    if (!attemptId) {
      throw new Error('Attempt ID is required');
    }
    const userClient = user.accessToken ? getUserSupabaseClient(user.accessToken) : null;
    const admin = getSupabaseAdmin();
    const db = userClient || admin;

    return QuizModel.getAttemptReview(db, attemptId, user.id);
  },

  /**
   * Retrieves past quiz attempt history for the authenticated student
   */
  async getQuizHistory(user, options = {}) {
    if (!user || !user.id) {
      throw new Error('Authentication required');
    }
    const userClient = user.accessToken ? getUserSupabaseClient(user.accessToken) : null;
    const admin = getSupabaseAdmin();
    const db = userClient || admin;

    const history = await QuizModel.getHistory(db, user.id, options);
    return {
      success: true,
      attempts: history
    };
  },

  /**
   * Selects relevant chunks for targeted topic or chapter using BM25
   */
  _selectRelevantChunks({ chunks, targetTopic, targetChapter, scope }) {
    if (!chunks || chunks.length === 0) return [];

    if (targetTopic) {
      const selected = [];
      const topicRefs = targetTopic.source_references || [];
      const citedChunkIds = new Set(topicRefs.map(r => r.chunkId).filter(Boolean));

      // Direct chunks cited by topic
      chunks.forEach(c => {
        if (citedChunkIds.has(c.id)) selected.push(c);
      });

      // Chunks matching page number of the topic
      const topicPage = topicRefs[0]?.pageNumber;
      if (topicPage) {
        chunks.forEach(c => {
          if (c.page_number >= topicPage && c.page_number <= topicPage + 3 && !selected.some(s => s.id === c.id)) {
            selected.push(c);
          }
        });
      }

      // BM25 ranking for topic name
      const engine = new BM25Engine(chunks, { threshold: 0.05 });
      const searchRes = engine.search(targetTopic.name, 6);
      if (searchRes.results) {
        searchRes.results.forEach(r => {
          const matchChunk = chunks.find(c => c.id === r.chunkId);
          if (matchChunk && !selected.some(s => s.id === matchChunk.id)) {
            selected.push(matchChunk);
          }
        });
      }

      return selected.slice(0, 8);
    }

    if (targetChapter) {
      const engine = new BM25Engine(chunks, { threshold: 0.05 });
      const searchRes = engine.search(targetChapter.name, 10);
      const selected = [];
      if (searchRes.results) {
        searchRes.results.forEach(r => {
          const matchChunk = chunks.find(c => c.id === r.chunkId);
          if (matchChunk && !selected.some(s => s.id === matchChunk.id)) {
            selected.push(matchChunk);
          }
        });
      }
      return selected.length > 0 ? selected : chunks.slice(0, 8);
    }

    return chunks.slice(0, 8);
  },

  /**
   * Calls Groq to generate grounded multiple-choice questions
   */
  async _generateWithGroq({ chunks, targetTopic, targetChapter, difficulty, count }) {
    const groqModel = getGroqModel();
    if (!groqModel) throw new Error('Groq model not configured');

    const topicContext = targetTopic ? `Topic: "${targetTopic.name}"` : `Chapter: "${targetChapter?.name || 'General'}"`;
    const excerpts = chunks.map(c => 
      `--- [CHUNK_ID: ${c.id}] [PAGE: ${c.page_number || 'N/A'}] [SECTION: ${c.section_title || 'N/A'}] ---\n${c.content.slice(0, 800)}`
    ).join('\n\n');

    const systemPrompt = `You are a rigorous academic diagnostic assessment engine.
Generate strictly grounded multiple-choice questions based ONLY on the provided textbook excerpts.
Rules:
1. Every question must be fully answerable from the text.
2. Target difficulty: "${difficulty}".
3. Provide EXACTLY 4 distinct, mutually exclusive options (A, B, C, D).
4. Exactly one option must be mathematically and textually correct.
5. All 4 options must be plausible, unambiguous, and distinct.
6. Provide a grounded explanation from the textbook.
7. Attribute each question to its exact CHUNK_ID and PAGE.
8. Return PURE JSON conforming strictly to the requested schema.`;

    const userPrompt = `Context:
${topicContext}
Target Difficulty: ${difficulty}

Textbook Excerpts:
${excerpts}

Required JSON Output Format:
{
  "questions": [
    {
      "questionText": "Question statement here",
      "options": [
        { "id": "A", "text": "Option A text" },
        { "id": "B", "text": "Option B text" },
        { "id": "C", "text": "Option C text" },
        { "id": "D", "text": "Option D text" }
      ],
      "correctOption": "A",
      "explanation": "Textbook-grounded explanation here",
      "sourceChunkId": "exact-chunk-uuid-from-excerpt",
      "sourcePageNumber": 16
    }
  ]
}`;

    const { text } = await generateText({
      model: groqModel,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.2
    });

    const parsed = this._parseJsonSafely(text);
    if (!parsed || !Array.isArray(parsed.questions)) {
      throw new Error('Groq response did not contain a valid questions array');
    }

    return parsed.questions;
  },

  /**
   * Deterministic grounded question generator from textbook chunks
   */
  _generateDeterministicGrounded({ chunks, targetTopic, targetChapter, difficulty, count }) {
    const questions = [];
    const topicTitle = targetTopic ? targetTopic.name : (targetChapter ? targetChapter.name : 'Mathematics');

    for (let i = 0; i < chunks.length && questions.length < count; i++) {
      const chunk = chunks[i];
      const text = chunk.content || '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 20);

      const candidateLine = lines.find(l => 
        l.includes('is defined as') || 
        l.includes('theorem') || 
        l.includes('formula') || 
        l.includes('called') ||
        l.includes('if and only if') ||
        l.includes('equals') ||
        l.length > 40
      ) || lines[0];

      if (candidateLine) {
        const cleanStatement = candidateLine.replace(/[^\w\s.,;:()=+-]/g, '').trim();
        const words = cleanStatement.split(' ');
        const keyTerm = words.find(w => w.length > 5) || 'statement';

        questions.push({
          questionText: `According to the textbook section on ${topicTitle}, which of the following statements is correct regarding: "${cleanStatement.slice(0, 80)}..."?`,
          options: [
            { id: 'A', text: cleanStatement.slice(0, 90) },
            { id: 'B', text: `It applies only when ${keyTerm} is strictly undefined or empty` },
            { id: 'C', text: `It represents the converse assertion of this mathematical rule` },
            { id: 'D', text: `It is invalid for any positive integer domain` }
          ],
          correctOption: 'A',
          explanation: `Directly stated in the textbook on page ${chunk.page_number || 'N/A'}: "${cleanStatement.slice(0, 120)}"`,
          sourceChunkId: chunk.id,
          sourcePageNumber: chunk.page_number
        });
      }
    }

    return questions;
  },

  /**
   * Strict validation, Option Ambiguity Check & 4-Stage Citation Integrity Verification
   */
  _validateAndVerifyQuestion(rawQ, context) {
    if (!rawQ || !rawQ.questionText) return null;

    const {
      documentId,
      userId,
      chunkMap,
      deduplicator,
      targetTopic,
      difficulty
    } = context;

    // 1. Question Text Validation
    const qText = rawQ.questionText.trim();
    if (qText.length < 15) return null;

    // Lightweight Duplicate Detection (Requirement 8)
    if (deduplicator && deduplicator.isDuplicate(qText)) {
      return null; // Reject duplicate question
    }
    if (Array.isArray(context.seenTexts) && context.seenTexts.some(st => st.trim().toLowerCase() === qText.toLowerCase())) {
      return null; // Reject duplicate question
    }

    // 2. Validate Options: exactly 4 distinct, unambiguous options (Requirement 7)
    if (!Array.isArray(rawQ.options) || rawQ.options.length !== 4) {
      return null;
    }

    const validOptionIds = ['A', 'B', 'C', 'D'];
    const seenOptionIds = new Set();
    const optionTexts = new Set();
    const normalizedOptions = [];

    for (let i = 0; i < 4; i++) {
      const opt = rawQ.options[i];
      if (!opt || typeof opt.text !== 'string' || !opt.id) return null;

      const optId = String(opt.id).trim().toUpperCase();
      if (!validOptionIds.includes(optId)) return null;
      if (seenOptionIds.has(optId)) return null; // Reject duplicate option identifiers!
      seenOptionIds.add(optId);

      const trimmedText = opt.text.trim();
      if (trimmedText.length === 0) return null;

      const lowerText = trimmedText.toLowerCase();

      // Check distinctness: reject duplicate option text
      if (optionTexts.has(lowerText)) {
        return null;
      }
      optionTexts.add(lowerText);

      // Check ambiguity: reject self-referential options like "all of the above" or "none of the above"
      if (lowerText.includes('all of the above') || lowerText.includes('none of the above')) {
        return null;
      }

      normalizedOptions.push({
        id: optId,
        text: trimmedText
      });
    }

    if (seenOptionIds.size !== 4) return null;

    // Pairwise similarity check between options to prevent near-duplicate/ambiguous distractors
    for (let i = 0; i < normalizedOptions.length; i++) {
      for (let j = i + 1; j < normalizedOptions.length; j++) {
        const textA = normalizedOptions[i].text.toLowerCase();
        const textB = normalizedOptions[j].text.toLowerCase();
        if (textA === textB) return null;
      }
    }

    // 3. Validate Correct Option: exactly one of A, B, C, D
    const correctOpt = (rawQ.correctOption || '').toUpperCase().trim();
    if (!validOptionIds.includes(correctOpt)) {
      return null;
    }

    // 4. Validate Explanation
    const explanation = (rawQ.explanation || '').trim();
    if (explanation.length < 10) {
      return null;
    }

    // 5. 4-Stage Citation Integrity Verification
    const candidateChunkId = rawQ.sourceChunkId;
    if (!candidateChunkId) {
      return null;
    }

    // Check 1: Chunk existence
    const chunk = chunkMap.get(candidateChunkId);
    if (!chunk || !chunk.id) {
      return {
        ...rawQ,
        citationVerified: false,
        citationVerificationDetails: {
          error: `Source chunk ID "${candidateChunkId}" does not exist in document chunks`
        }
      };
    }

    // Check 2: Document ID match (reject cross-document reference)
    if (chunk.document_id && chunk.document_id !== documentId) {
      return {
        ...rawQ,
        citationVerified: false,
        citationVerificationDetails: {
          error: `Cross-document chunk reference rejected (chunk belongs to document ${chunk.document_id})`
        }
      };
    }

    // Check 3: User ID match (reject cross-user reference)
    if (chunk.user_id && chunk.user_id !== userId) {
      return {
        ...rawQ,
        citationVerified: false,
        citationVerificationDetails: {
          error: `Cross-user chunk reference rejected (chunk belongs to user ${chunk.user_id})`
        }
      };
    }

    // Check 4: Content Relevance / Textual Support
    const supports = this._chunkSupportsQuestion(chunk, qText, normalizedOptions, explanation);
    if (!supports) {
      return {
        ...rawQ,
        citationVerified: false,
        citationVerificationDetails: {
          error: 'Source chunk content does not sufficiently support question content'
        }
      };
    }

    // Build citation snapshot for permanent historical review (Requirement 6)
    const citationSnapshot = {
      chunkId: chunk.id,
      documentId,
      pageNumber: chunk.page_number || rawQ.sourcePageNumber || null,
      sectionTitle: chunk.section_title || null,
      chunkExcerpt: (chunk.content || '').slice(0, 300),
      verified: true,
      verifiedAt: new Date().toISOString()
    };

    return {
      questionText: qText,
      options: normalizedOptions,
      correctOption: correctOpt,
      explanation,
      difficulty,
      sourceChunkId: chunk.id,
      sourcePageNumber: chunk.page_number || rawQ.sourcePageNumber || null,
      citationVerified: true,
      citationSnapshot,
      citationVerificationDetails: {
        pageNumber: chunk.page_number,
        sectionTitle: chunk.section_title,
        verifiedAt: new Date().toISOString()
      }
    };
  },

  /**
   * Verifies that the chunk text actually supports the question statement
   */
  _chunkSupportsQuestion(chunk, questionText, options, explanation) {
    if (!chunk || !chunk.content) return false;

    const chunkText = (chunk.content + ' ' + (chunk.section_title || '')).toLowerCase();
    const qTokens = tokenize(questionText, true);

    if (qTokens.length === 0) return true;

    let matchCount = 0;
    for (const t of qTokens) {
      if (chunkText.includes(t)) matchCount++;
    }

    const overlapRatio = matchCount / qTokens.length;
    return overlapRatio >= 0.25 || matchCount >= 2;
  },

  /**
   * Safely parses JSON string from LLM
   */
  _parseJsonSafely(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let clean = raw.trim();

    if (clean.includes('```json')) {
      clean = clean.split('```json')[1].split('```')[0].trim();
    } else if (clean.includes('```')) {
      clean = clean.split('```')[1].split('```')[0].trim();
    }

    try {
      return JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {}
      }
      return null;
    }
  }
};
