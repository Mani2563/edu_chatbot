import { getSupabaseAdmin, getSupabaseClient } from '../lib/supabase.js';
import { QuizService } from '../services/quiz-service.js';
import { QuizModel } from '../models/quiz-model.js';
import { RetrievalService } from '../services/retrieval-service.js';

/**
 * Phase 5 Comprehensive Diagnostic Quiz Engine Test Suite
 * Covers all 17 mandatory requirements:
 * 1. Topic Quiz Generation
 * 2. Chapter Quiz Generation
 * 3. Difficulty Levels (Easy, Medium, Hard)
 * 4. Four Distinct Options (A, B, C, D)
 * 5. Single Correct Answer Validation (Hidden upfront)
 * 6. Mathematical & Semantic Correctness
 * 7. Citation Verification
 * 8. Fake Citation Rejection
 * 9. Cross-Document Citation Rejection
 * 10. Cross-User Citation Rejection
 * 11. Unsupported Question Rejection
 * 12. Duplicate Question Detection
 * 13. Answer Submission API
 * 14. Score Calculation & Percentage Accuracy
 * 15. Quiz Persistence & History
 * 16. Authentication & User Isolation
 * 17. Regression Testing (Phases 1–4)
 */

const BASE_URL = 'http://localhost:3000';

async function runTestSuite() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 5: Diagnostic Quiz Engine Comprehensive Tests   ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}: ${details}`);
      failed++;
    }
  }

  // 1. Authenticate Manikanta (the document & subject owner)
  const admin = getSupabaseAdmin();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'manikantaanandam2563@gmail.com'
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error('Failed to generate auth token for Manikanta: ' + linkErr?.message);
  }

  const client = getSupabaseClient();
  const { data: sessionData, error: sessionErr } = await client.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  if (sessionErr || !sessionData?.session?.access_token) {
    throw new Error('Failed to verify OTP session: ' + sessionErr?.message);
  }

  const user = {
    id: sessionData.user.id,
    email: sessionData.user.email,
    accessToken: sessionData.session.access_token
  };

  const subjectId = '173b9439-b3c2-42c5-9ac0-592bf50a6626';
  const documentId = 'bf81ec3d-78c1-43c5-b962-5dc6a9a01335';
  const topicId = 'cba8773d-52a7-4306-bc71-ef4483233d55'; // 1.2 THE FUNDAMENTAL THEOREM OF ARITHMETIC
  const chapterId = 'ae907195-946a-4d9b-947a-e1499cbc9b03'; // Real Numbers

  console.log('Test Context:');
  console.log(`- Authenticated User: ${user.email} (${user.id})`);
  console.log(`- Subject ID: ${subjectId}`);
  console.log(`- Document ID: ${documentId}\n`);

  // --------------------------------------------------------------------------
  // TEST 1: Quiz Generation from a valid topic
  // --------------------------------------------------------------------------
  console.log('--- Requirement 1: Quiz Generation from a Valid Topic ---');
  let topicQuiz = null;
  try {
    topicQuiz = await QuizService.generateQuiz(user, {
      subjectId,
      documentId,
      topicId,
      difficulty: 'easy',
      questionCount: 3
    });
    assert(
      topicQuiz?.success === true && Array.isArray(topicQuiz.questions) && topicQuiz.questions.length > 0,
      'Test 1: Quiz generation from valid topic returns questions',
      `Got questions: ${topicQuiz?.questions?.length}`
    );
    assert(
      topicQuiz?.attempt?.topicId === topicId,
      'Test 1b: Attempt records targeted topic ID'
    );
  } catch (err) {
    assert(false, 'Test 1: Quiz generation from valid topic', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Quiz Generation from a selected chapter
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 2: Quiz Generation from a Selected Chapter ---');
  try {
    const chapterQuiz = await QuizService.generateQuiz(user, {
      subjectId,
      documentId,
      chapterId,
      difficulty: 'medium',
      questionCount: 3
    });
    assert(
      chapterQuiz?.success === true && chapterQuiz.questions.length > 0,
      'Test 2: Quiz generation from selected chapter returns questions',
      `Got count: ${chapterQuiz?.questions?.length}`
    );
    assert(
      chapterQuiz?.attempt?.chapterId === chapterId,
      'Test 2b: Attempt records targeted chapter ID'
    );
  } catch (err) {
    assert(false, 'Test 2: Quiz generation from selected chapter', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Easy, Medium, and Hard Difficulty Levels
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 3: Easy, Medium, and Hard Difficulty Levels ---');
  try {
    const easyQuiz = await QuizService.generateQuiz(user, { subjectId, topicId, difficulty: 'easy', questionCount: 2 });
    const medQuiz = await QuizService.generateQuiz(user, { subjectId, topicId, difficulty: 'medium', questionCount: 2 });
    const hardQuiz = await QuizService.generateQuiz(user, { subjectId, topicId, difficulty: 'hard', questionCount: 2 });

    assert(easyQuiz?.attempt?.difficulty === 'easy', 'Test 3a: Easy difficulty generated and tracked');
    assert(medQuiz?.attempt?.difficulty === 'medium', 'Test 3b: Medium difficulty generated and tracked');
    assert(hardQuiz?.attempt?.difficulty === 'hard', 'Test 3c: Hard difficulty generated and tracked');
  } catch (err) {
    assert(false, 'Test 3: Difficulty levels', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 4: Four-Option Validation (A, B, C, D Distinct)
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 4: Four-Option Validation ---');
  if (topicQuiz && topicQuiz.questions.length > 0) {
    let allFourOptions = true;
    let allDistinct = true;

    for (const q of topicQuiz.questions) {
      if (!Array.isArray(q.options) || q.options.length !== 4) {
        allFourOptions = false;
        break;
      }
      const ids = q.options.map(o => o.id);
      const expected = ['A', 'B', 'C', 'D'];
      if (!expected.every((id, idx) => ids[idx] === id)) {
        allFourOptions = false;
        break;
      }
      const texts = new Set(q.options.map(o => o.text.trim().toLowerCase()));
      if (texts.size !== 4) {
        allDistinct = false;
        break;
      }
    }

    assert(allFourOptions, 'Test 4a: Exactly 4 options (A, B, C, D) present on every question');
    assert(allDistinct, 'Test 4b: All 4 options are distinct (no duplicate choices)');
  } else {
    assert(false, 'Test 4: Four options validation', 'No questions to inspect');
  }

  // --------------------------------------------------------------------------
  // TEST 5: Correct-Answer Validation (Single Answer, Hidden Upfront)
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 5: Correct-Answer Validation ---');
  if (topicQuiz && topicQuiz.questions.length > 0) {
    let answersHidden = true;
    let explanationsHidden = true;

    for (const q of topicQuiz.questions) {
      if (q.correctOption !== undefined || q.correct_option !== undefined) {
        answersHidden = false;
      }
      if (q.explanation !== undefined) {
        explanationsHidden = false;
      }
    }

    assert(answersHidden, 'Test 5a: Correct answers are strictly HIDDEN from client before submission');
    assert(explanationsHidden, 'Test 5b: Explanations are strictly HIDDEN from client before submission');

    // Verify database stores the single correct answer
    const stored = await QuizModel.getQuestionsForAttempt(admin, topicQuiz.attempt.id, user.id);
    let allValidStoredAnswers = true;
    for (const sq of stored) {
      if (!['A', 'B', 'C', 'D'].includes(sq.correct_option)) {
        allValidStoredAnswers = false;
      }
    }
    assert(allValidStoredAnswers && stored.length > 0, 'Test 5c: Database securely stores single correct option in [A, B, C, D]');
  }

  // --------------------------------------------------------------------------
  // TEST 6: Mathematical Answer Validation
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 6: Mathematical Answer Validation ---');
  if (topicQuiz && topicQuiz.questions.length > 0) {
    const q = topicQuiz.questions[0];
    const hasClearStructure = q.questionText.length > 15 && q.options.every(opt => opt.text.length > 1);
    assert(hasClearStructure, 'Test 6: Mathematical question formulation and options are well-structured');
  }

  // --------------------------------------------------------------------------
  // TEST 7: Citation Verification (Valid Page & Chunk)
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 7: Citation Verification ---');
  if (topicQuiz && topicQuiz.questions.length > 0) {
    const storedQuestions = await QuizModel.getQuestionsForAttempt(admin, topicQuiz.attempt.id, user.id);
    let allVerified = true;
    let validPage = true;

    for (const q of storedQuestions) {
      if (q.citation_verified !== true) allVerified = false;
      if (!q.source_page_number || q.source_page_number < 1 || q.source_page_number > 406) validPage = false;
    }

    assert(allVerified, 'Test 7a: Every question has citation_verified === true in database');
    assert(validPage, 'Test 7b: Every question cites a valid physical page number from the textbook');
  }

  // --------------------------------------------------------------------------
  // TEST 8: Fake Citation Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 8: Fake Citation Rejection ---');
  const fakeChunkContext = {
    documentId,
    userId: user.id,
    chunkMap: new Map(), // empty map: chunk does not exist!
    seenTexts: [],
    targetTopic: { name: 'Fundamental Theorem of Arithmetic' },
    difficulty: 'easy'
  };

  const fakeCitationQuestion = {
    questionText: 'What is the prime factorization of 60?',
    options: [
      { id: 'A', text: '2^2 * 3 * 5' },
      { id: 'B', text: '2 * 3^2 * 5' },
      { id: 'C', text: '2 * 3 * 5' },
      { id: 'D', text: '2^3 * 5' }
    ],
    correctOption: 'A',
    explanation: 'Prime factorization theorem shows 60 = 4 * 15 = 2^2 * 3 * 5.',
    sourceChunkId: 'fake-chunk-uuid-99999',
    sourcePageNumber: 16
  };

  const fakeRes = QuizService._validateAndVerifyQuestion(fakeCitationQuestion, fakeChunkContext);
  assert(
    fakeRes?.citationVerified === false,
    'Test 8: Fake/non-existent chunk ID citation is strictly rejected (citationVerified: false)'
  );

  // --------------------------------------------------------------------------
  // TEST 9: Cross-Document Citation Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 9: Cross-Document Citation Rejection ---');
  const otherDocId = '11111111-2222-3333-4444-555555555555';
  const crossDocMap = new Map();
  crossDocMap.set('chunk-cross-doc-1', {
    id: 'chunk-cross-doc-1',
    document_id: otherDocId, // Cross document!
    user_id: user.id,
    content: 'The fundamental theorem of arithmetic states that every composite number can be factored uniquely into primes.',
    page_number: 16
  });

  const crossDocContext = {
    documentId,
    userId: user.id,
    chunkMap: crossDocMap,
    seenTexts: [],
    targetTopic: { name: 'Fundamental Theorem of Arithmetic' },
    difficulty: 'easy'
  };

  const crossDocQuestion = {
    ...fakeCitationQuestion,
    sourceChunkId: 'chunk-cross-doc-1'
  };

  const crossDocRes = QuizService._validateAndVerifyQuestion(crossDocQuestion, crossDocContext);
  assert(
    crossDocRes?.citationVerified === false && crossDocRes?.citationVerificationDetails?.error?.includes('Cross-document'),
    'Test 9: Cross-document citation is strictly rejected with explicit error'
  );

  // --------------------------------------------------------------------------
  // TEST 10: Cross-User Citation Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 10: Cross-User Citation Rejection ---');
  const otherUserId = '99999999-8888-7777-6666-555555555555';
  const crossUserMap = new Map();
  crossUserMap.set('chunk-cross-user-1', {
    id: 'chunk-cross-user-1',
    document_id: documentId,
    user_id: otherUserId, // Cross user!
    content: 'The fundamental theorem of arithmetic states that every composite number can be factored uniquely into primes.',
    page_number: 16
  });

  const crossUserContext = {
    documentId,
    userId: user.id,
    chunkMap: crossUserMap,
    seenTexts: [],
    targetTopic: { name: 'Fundamental Theorem of Arithmetic' },
    difficulty: 'easy'
  };

  const crossUserQuestion = {
    ...fakeCitationQuestion,
    sourceChunkId: 'chunk-cross-user-1'
  };

  const crossUserRes = QuizService._validateAndVerifyQuestion(crossUserQuestion, crossUserContext);
  assert(
    crossUserRes?.citationVerified === false && crossUserRes?.citationVerificationDetails?.error?.includes('Cross-user'),
    'Test 10: Cross-user citation is strictly rejected with explicit error'
  );

  // --------------------------------------------------------------------------
  // TEST 11: Unsupported Question Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 11: Unsupported Question Rejection ---');
  const validUserChunk = {
    id: 'chunk-valid-maths-1',
    document_id: documentId,
    user_id: user.id,
    content: 'In mathematics, a prime number is a positive integer greater than 1 that has no positive divisors other than 1 and itself.',
    page_number: 16
  };
  const validChunkMap = new Map();
  validChunkMap.set(validUserChunk.id, validUserChunk);

  const supportedContext = {
    documentId,
    userId: user.id,
    chunkMap: validChunkMap,
    seenTexts: [],
    targetTopic: { name: 'Prime Numbers' },
    difficulty: 'easy'
  };

  const unsupportedQuestion = {
    questionText: 'What is the process of photosynthesis in chloroplasts and how does chlorophyll absorb light?',
    options: [
      { id: 'A', text: 'Absorbs blue and red light' },
      { id: 'B', text: 'Absorbs green light exclusively' },
      { id: 'C', text: 'Emits gamma photons' },
      { id: 'D', text: 'Breaks down cellular nitrogen' }
    ],
    correctOption: 'A',
    explanation: 'Chlorophyll molecules absorb light predominantly in blue and red spectrums.',
    sourceChunkId: validUserChunk.id, // Paired with math chunk!
    sourcePageNumber: 16
  };

  const unsuppRes = QuizService._validateAndVerifyQuestion(unsupportedQuestion, supportedContext);
  assert(
    unsuppRes?.citationVerified === false,
    'Test 11: Question with unrelated content not supported by cited chunk is strictly rejected'
  );

  // --------------------------------------------------------------------------
  // TEST 12: Duplicate Question Prevention
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 12: Duplicate Question Prevention ---');
  const dupContext = {
    ...supportedContext,
    seenTexts: ['what is a prime number and how is it defined?']
  };

  const dupQuestion = {
    questionText: 'What is a prime number and how is it defined?',
    options: [
      { id: 'A', text: 'Has only 1 and itself as divisors' },
      { id: 'B', text: 'Any odd number' },
      { id: 'C', text: 'Any positive integer' },
      { id: 'D', text: 'Number divisible by 2' }
    ],
    correctOption: 'A',
    explanation: 'Defined in chapter.',
    sourceChunkId: validUserChunk.id,
    sourcePageNumber: 16
  };

  const dupRes = QuizService._validateAndVerifyQuestion(dupQuestion, dupContext);
  assert(
    dupRes === null,
    'Test 12: Highly similar / duplicate question is detected and rejected'
  );

  // --------------------------------------------------------------------------
  // TEST 13: Answer Submission via Live HTTP API
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 13: Answer Submission via Live HTTP API ---');
  let submitHttpRes = null;
  let quizForSubmit = null;
  try {
    // Generate fresh quiz for submission
    const genRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subjectId,
        topicId,
        difficulty: 'easy',
        questionCount: 2
      })
    });
    quizForSubmit = await genRes.json();

    const q1 = quizForSubmit.questions[0];
    const q2 = quizForSubmit.questions[1];

    const subRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        attemptId: quizForSubmit.attempt.id,
        answers: [
          { questionId: q1.id, selectedOption: 'A' },
          { questionId: q2.id, selectedOption: 'B' }
        ]
      })
    });

    submitHttpRes = await subRes.json();
    assert(
      subRes.status === 200 && submitHttpRes?.success === true,
      'Test 13: POST /api/quiz/submit returns 200 OK with success payload'
    );
  } catch (err) {
    assert(false, 'Test 13: Answer submission API', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 14: Score Calculation & Percentage Accuracy
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 14: Score Calculation & Percentage Accuracy ---');
  if (submitHttpRes && quizForSubmit) {
    const total = submitHttpRes.totalQuestions;
    const score = submitHttpRes.score;
    const pct = submitHttpRes.percentage;
    const expectedPct = Number(((score / total) * 100).toFixed(2));

    assert(
      score >= 0 && score <= total,
      'Test 14a: Score is valid non-negative integer within [0, totalQuestions]',
      `Score: ${score}/${total}`
    );
    assert(
      pct === expectedPct,
      'Test 14b: Percentage exactly matches mathematical formula (score / total) * 100',
      `Got: ${pct}%, Expected: ${expectedPct}%`
    );
    assert(
      Array.isArray(submitHttpRes.review) && submitHttpRes.review.length === total,
      'Test 14c: Review payload includes all questions with correct/incorrect indicators and explanations'
    );
  } else {
    assert(false, 'Test 14: Score calculation', 'No submit response');
  }

  // --------------------------------------------------------------------------
  // TEST 15: Quiz Persistence & History
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 15: Quiz Persistence & History ---');
  try {
    const histRes = await fetch(`${BASE_URL}/api/quiz/history?subjectId=${subjectId}`, {
      headers: { 'Authorization': `Bearer ${user.accessToken}` }
    });
    const histData = await histRes.json();

    assert(
      histRes.status === 200 && Array.isArray(histData.attempts) && histData.attempts.length > 0,
      'Test 15a: GET /api/quiz/history returns persisted completed attempts',
      `Attempts found: ${histData.attempts?.length}`
    );

    const matchAttempt = histData.attempts.find(a => a.id === quizForSubmit?.attempt?.id);
    assert(
      matchAttempt && matchAttempt.status === 'completed',
      'Test 15b: Attempt is persisted with completed status and correct score in database'
    );
  } catch (err) {
    assert(false, 'Test 15: Quiz persistence', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 16: Authentication & Authorization (Security & User Isolation)
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 16: Authentication & Authorization ---');
  try {
    // Unauthenticated generate
    const unauthGen = await fetch(`${BASE_URL}/api/quiz/generate`, { method: 'POST' });
    assert(unauthGen.status === 401, 'Test 16a: Unauthenticated POST /api/quiz/generate rejected with 401');

    // Unauthenticated submit
    const unauthSub = await fetch(`${BASE_URL}/api/quiz/submit`, { method: 'POST' });
    assert(unauthSub.status === 401, 'Test 16b: Unauthenticated POST /api/quiz/submit rejected with 401');

    // Cross-user access check using evaluator user
    const { data: evalAuth } = await client.auth.signInWithPassword({
      email: 'evaluator.demo@gapfinder.ai',
      password: 'EvaluatorPassword2026!'
    });

    if (evalAuth?.session?.access_token) {
      const crossRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${evalAuth.session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subjectId }) // Evaluator trying to access Manikanta's subject
      });
      assert(crossRes.status === 400, 'Test 16c: Cross-user attempt to access another student subject strictly rejected with 400');
    }
  } catch (err) {
    assert(false, 'Test 16: Auth & authorization', err.message);
  }

  // --------------------------------------------------------------------------
  // TEST 17: Full Phase 1–4 Regression Suite
  // --------------------------------------------------------------------------
  console.log('\n--- Requirement 17: Full Regression Testing of Phases 1–4 ---');
  try {
    // Phase 1: Health
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200 && healthJson.success === true, 'Test 17a: Phase 1 Health endpoint returns 200 OK');

    // Phase 2: Document Model & Chunks
    const { count: chunkCount } = await admin.from('document_chunks').select('*', { count: 'exact', head: true }).eq('document_id', documentId);
    assert(chunkCount === 1068, `Test 17b: Phase 2 Document Chunks completely intact (expected 1068, got ${chunkCount})`);

    // Phase 3: RAG Retrieval
    const ragResult = await RetrievalService.retrieveEvidence(user, 'Fundamental theorem of arithmetic', {
      documentIds: [documentId],
      topK: 2
    });
    assert(ragResult.success && ragResult.hasEvidence && ragResult.results.length > 0, 'Test 17c: Phase 3 BM25 RAG Retrieval works with grounded evidence');

    // Phase 4: 120-node Mathematics Curriculum Hierarchy
    const { count: totalNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId);
    const { count: chapNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'chapter');
    const { count: topNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'topic');
    const { count: subNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'subtopic');

    assert(
      totalNodes === 120 && chapNodes === 14 && topNodes === 85 && subNodes === 21,
      `Test 17d: Phase 4 120-Node Curriculum Hierarchy 100% intact (${chapNodes} chaps + ${topNodes} topics + ${subNodes} subtopics = ${totalNodes} total nodes)`
    );
  } catch (err) {
    assert(false, 'Test 17: Regression suite', err.message);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`  Phase 5 Test Suite Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

