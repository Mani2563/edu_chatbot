import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { QuizService } from '../services/quiz-service.js';
import { QuizModel } from '../models/quiz-model.js';
import { RetrievalService } from '../services/retrieval-service.js';

const BASE_URL = 'http://localhost:3000';

async function runComprehensiveSecurityAndIntegritySuite() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 5: Critical Security, Integrity & Verification  ');
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

  // 1. Authenticate Account 1: Manikanta (Primary student & owner)
  const admin = getSupabaseAdmin();
  const { data: link1 } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: 'manikantaanandam2563@gmail.com'
  });
  const client = getSupabaseClient();
  const { data: sess1 } = await client.auth.verifyOtp({
    token_hash: link1.properties.hashed_token,
    type: 'magiclink'
  });
  const user1 = {
    id: sess1.user.id,
    email: sess1.user.email,
    accessToken: sess1.session.access_token
  };

  // 2. Authenticate Account 2: Evaluator (Separate test student for RLS isolation)
  const { data: evalAuth, error: evalErr } = await client.auth.signInWithPassword({
    email: 'evaluator.demo@gapfinder.ai',
    password: 'EvaluatorPassword2026!'
  });
  if (evalErr) throw new Error('Evaluator signin failed: ' + evalErr.message);
  const user2 = {
    id: evalAuth.user.id,
    email: evalAuth.user.email,
    accessToken: evalAuth.session.access_token
  };

  const subjectId = '173b9439-b3c2-42c5-9ac0-592bf50a6626';
  const documentId = 'bf81ec3d-78c1-43c5-b962-5dc6a9a01335';
  const topicId = 'cba8773d-52a7-4306-bc71-ef4483233d55'; // 1.2 THE FUNDAMENTAL THEOREM OF ARITHMETIC
  const chapterId = 'ae907195-946a-4d9b-947a-e1499cbc9b03'; // Real Numbers

  console.log('Security Context:');
  console.log(`- Account 1 (Owner): ${user1.email} (${user1.id})`);
  console.log(`- Account 2 (Separate Student): ${user2.email} (${user2.id})`);
  console.log(`- Subject ID: ${subjectId}`);
  console.log(`- Document ID: ${documentId}\n`);

  // --------------------------------------------------------------------------
  // SECTION A: Core Quiz Generation & Grounding (Req 1, 2, 3)
  // --------------------------------------------------------------------------
  console.log('--- Section A: Quiz Generation & Grounding ---');
  let activeQuiz = null;
  try {
    activeQuiz = await QuizService.generateQuiz(user1, {
      subjectId,
      documentId,
      topicId,
      difficulty: 'easy',
      questionCount: 3
    });
    assert(
      activeQuiz?.success === true && activeQuiz.questions.length > 0,
      'Req 1: Topic quiz generated with questions'
    );

    const chapQuiz = await QuizService.generateQuiz(user1, {
      subjectId,
      documentId,
      chapterId,
      difficulty: 'medium',
      questionCount: 3
    });
    assert(
      chapQuiz?.success === true && chapQuiz.questions.length > 0,
      'Req 2: Chapter quiz generated spanning chapter material'
    );

    const hardQuiz = await QuizService.generateQuiz(user1, {
      subjectId,
      topicId,
      difficulty: 'hard',
      questionCount: 2
    });
    assert(
      hardQuiz?.attempt?.difficulty === 'hard',
      'Req 3: Difficulty selection (easy/medium/hard) recorded accurately'
    );
  } catch (err) {
    assert(false, 'Section A', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION B: Concealment & Quality Assurance (Req 2, 4, 7)
  // --------------------------------------------------------------------------
  console.log('\n--- Section B: Answer Concealment & Quality Assurance ---');
  if (activeQuiz && activeQuiz.questions.length > 0) {
    // Check 1: No correct answers or explanations in active response
    let hidden = true;
    for (const q of activeQuiz.questions) {
      if (q.correctOption !== undefined || q.correct_option !== undefined || q.explanation !== undefined) {
        hidden = false;
      }
    }
    assert(
      hidden,
      'Addition 2: Correct answers and explanations are STRICTLY HIDDEN from active quiz payload'
    );

    // Check 2: Exactly 4 distinct options (A, B, C, D)
    let validOptions = true;
    for (const q of activeQuiz.questions) {
      if (!Array.isArray(q.options) || q.options.length !== 4) validOptions = false;
      const ids = q.options.map(o => o.id).join('');
      if (ids !== 'ABCD') validOptions = false;
      const texts = new Set(q.options.map(o => o.text.trim().toLowerCase()));
      if (texts.size !== 4) validOptions = false;
    }
    assert(
      validOptions,
      'Addition 7a: Exactly four distinct options (A, B, C, D) without duplicates or empty choices'
    );

    // Check 3: Rejection of ambiguous options ("all of the above", "none of the above")
    const testContext = {
      documentId,
      userId: user1.id,
      chunkMap: new Map([['test-chunk', { id: 'test-chunk', document_id: documentId, user_id: user1.id, content: 'A prime number is a positive integer greater than 1 that has no positive divisors other than 1 and itself.' }]]),
      deduplicator: null,
      targetTopic: { name: 'Prime Numbers' },
      difficulty: 'easy'
    };
    const ambiguousQ = {
      questionText: 'Which statement accurately describes a prime number in arithmetic?',
      options: [
        { id: 'A', text: 'Has only 1 and itself as factors' },
        { id: 'B', text: 'All of the above' }, // Ambiguous!
        { id: 'C', text: 'Divisible by 2' },
        { id: 'D', text: 'None of the above' } // Ambiguous!
      ],
      correctOption: 'A',
      explanation: 'Textbook definition.',
      sourceChunkId: 'test-chunk'
    };
    const ambigRes = QuizService._validateAndVerifyQuestion(ambiguousQ, testContext);
    assert(
      ambigRes === null,
      'Addition 7b: Questions containing ambiguous choices ("All/None of the above") are strictly rejected'
    );
  }

  // --------------------------------------------------------------------------
  // SECTION C: Citation Integrity & Snapshot Preservation (Req 6, 7)
  // --------------------------------------------------------------------------
  console.log('\n--- Section C: Citation Integrity & Snapshot Preservation ---');
  if (activeQuiz) {
    const stored = await QuizModel.getQuestionsForAttempt(admin, activeQuiz.attempt.id, user1.id);
    let allVerified = true;
    let hasSnapshot = true;

    for (const q of stored) {
      if (q.citation_verified !== true) allVerified = false;
      if (!q.citation_snapshot || !q.citation_snapshot.verified) hasSnapshot = false;
    }

    assert(allVerified, 'Req 7: All questions have citation_verified === true in database');
    assert(
      hasSnapshot,
      'Addition 6: Frozen citation_snapshot is preserved on question records for historical resilience'
    );
  }

  // --------------------------------------------------------------------------
  // SECTION D: Lightweight Duplicate Detection (Addition 8)
  // --------------------------------------------------------------------------
  console.log('\n--- Section D: Lightweight Duplicate Detection (BM25 Architecture) ---');
  const validChunk = {
    id: 'chunk-math-real-1',
    document_id: documentId,
    user_id: user1.id,
    content: 'The fundamental theorem of arithmetic states that every composite number can be expressed as a product of primes uniquely.',
    page_number: 16
  };
  const chunkMap = new Map([[validChunk.id, validChunk]]);

  // Test duplicate rejection via _validateAndVerifyQuestion
  const baseQuestion = {
    questionText: 'What is the primary statement of the fundamental theorem of arithmetic?',
    options: [
      { id: 'A', text: 'Every composite number can be uniquely factored into primes' },
      { id: 'B', text: 'Every integer is prime' },
      { id: 'C', text: 'Primes cannot be multiplied' },
      { id: 'D', text: 'Composite numbers have no factors' }
    ],
    correctOption: 'A',
    explanation: 'Fundamental theorem of arithmetic statement.',
    sourceChunkId: validChunk.id
  };

  const contextWithDedup = {
    documentId,
    userId: user1.id,
    chunkMap,
    deduplicator: {
      isDuplicate: (text) => text.toLowerCase().includes('fundamental theorem of arithmetic'),
      add: () => {}
    },
    targetTopic: { name: 'Fundamental Theorem' },
    difficulty: 'easy'
  };

  const dupResult = QuizService._validateAndVerifyQuestion(baseQuestion, contextWithDedup);
  assert(
    dupResult === null,
    'Addition 8: Lightweight lexical duplicate detector successfully caught and rejected duplicate question'
  );

  // --------------------------------------------------------------------------
  // SECTION E: Server-Side Score Calculation & Spoof Protection (Addition 1)
  // --------------------------------------------------------------------------
  console.log('\n--- Section E: Server-Side Score Calculation & Spoof Protection ---');
  let testAttempt = null;
  try {
    const genRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user1.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subjectId,
        topicId,
        difficulty: 'easy',
        questionCount: 2
      })
    });
    const freshQuiz = await genRes.json();
    testAttempt = freshQuiz.attempt;

    const q1 = freshQuiz.questions[0];
    const q2 = freshQuiz.questions[1];

    // Attempt client score spoofing: send score: 999, percentage: 100 via HTTP
    const spoofRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user1.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        attemptId: testAttempt.id,
        score: 999,          // Spoofed score!
        percentage: 100.0,   // Spoofed percentage!
        answers: [
          { questionId: q1.id, selectedOption: 'A' },
          { questionId: q2.id, selectedOption: 'B' }
        ]
      })
    });

    const submitResult = await spoofRes.json();
    assert(
      submitResult.success === true && submitResult.score !== 999,
      'Addition 1a: Server completely ignores client-supplied score and computes score server-side'
    );
    const expectedPct = Number(((submitResult.score / submitResult.totalQuestions) * 100).toFixed(2));
    assert(
      submitResult.percentage === expectedPct,
      'Addition 1b: Server-computed percentage matches mathematical ground truth',
      `Calculated: ${submitResult.percentage}%, Expected: ${expectedPct}%`
    );
  } catch (err) {
    assert(false, 'Section E', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION F: Completed Attempt Resubmission Lock (Addition 5)
  // --------------------------------------------------------------------------
  console.log('\n--- Section F: Resubmission Prevention on Completed Attempt ---');
  if (testAttempt) {
    try {
      const resubRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user1.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          attemptId: testAttempt.id,
          answers: []
        })
      });

      const resubJson = await resubRes.json();
      assert(
        resubRes.status === 400 && resubJson.error?.includes('already been submitted and completed'),
        'Addition 5: Resubmission on a completed attempt is strictly blocked with error'
      );
    } catch (err) {
      assert(false, 'Section F', err.message);
    }
  }

  // --------------------------------------------------------------------------
  // SECTION G: Foreign Question & Attempt Boundary Integrity (Addition 3 & 4)
  // --------------------------------------------------------------------------
  console.log('\n--- Section G: Question & Attempt Relationship Integrity ---');
  try {
    const quizForForeignTest = await QuizService.generateQuiz(user1, {
      subjectId,
      topicId,
      difficulty: 'easy',
      questionCount: 2
    });

    // Attempt to submit answers for a foreign / fabricated question ID
    const foreignQRes = await QuizService.submitQuiz(user1, {
      attemptId: quizForForeignTest.attempt.id,
      answers: [
        { questionId: '00000000-1111-2222-3333-444444444444', selectedOption: 'A' },
        { questionId: quizForForeignTest.questions[0].id, selectedOption: 'A' }
      ]
    });

    // Check that review only evaluates legitimate questions belonging to this attempt
    assert(
      foreignQRes.totalQuestions === 2 && foreignQRes.review.every(r => r.questionId !== '00000000-1111-2222-3333-444444444444'),
      'Addition 4: Foreign question ID injected into submission is strictly rejected / ignored'
    );
  } catch (err) {
    assert(false, 'Section G', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION H: Multi-Account RLS & Direct API Access Security (Addition 11)
  // --------------------------------------------------------------------------
  console.log('\n--- Section H: Multi-Account RLS & Direct API Access ---');
  try {
    // 1. Account 2 attempts to generate quiz on Account 1's subject
    const crossGen = await fetch(`${BASE_URL}/api/quiz/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${user2.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ subjectId: subjectId }) // Account 1's subject
    });
    const crossGenJson = await crossGen.json();
    assert(
      crossGen.status === 400 && crossGenJson.error?.includes('Subject not found or access denied'),
      'Addition 11a: Account 2 cannot generate quiz for Account 1 subject (Direct API blocked)'
    );

    // 2. Account 2 attempts to submit answers to Account 1's attempt
    if (testAttempt) {
      const crossSub = await fetch(`${BASE_URL}/api/quiz/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user2.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ attemptId: testAttempt.id, answers: [] })
      });
      const crossSubJson = await crossSub.json();
      assert(
        crossSub.status === 400 && crossSubJson.error?.includes('access denied'),
        'Addition 11b: Account 2 cannot submit answers to Account 1 attempt (Direct API blocked)'
      );
    }

    // 3. Account 2 attempts to view Account 1's history
    const crossHist = await fetch(`${BASE_URL}/api/quiz/history?subjectId=${subjectId}`, {
      headers: { 'Authorization': `Bearer ${user2.accessToken}` }
    });
    const crossHistJson = await crossHist.json();
    assert(
      crossHist.status === 200 && Array.isArray(crossHistJson.attempts) && crossHistJson.attempts.length === 0,
      'Addition 11c: Account 2 history query for Account 1 subject returns empty (Isolation enforced)'
    );

    // 4. Direct Supabase RLS Query under Account 2's token
    const user2Client = getUserSupabaseClient(user2.accessToken);
    const { data: rlsAttempts } = await user2Client
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', user1.id); // Try to select Account 1's records
    assert(
      !rlsAttempts || rlsAttempts.length === 0,
      'Addition 11d: Supabase RLS directly prevents Account 2 from reading Account 1 attempts'
    );
  } catch (err) {
    assert(false, 'Section H', err.message);
  }

  // --------------------------------------------------------------------------
  // SECTION I: Post-Migration Student Data & Curriculum Preservation (Addition 10)
  // --------------------------------------------------------------------------
  console.log('\n--- Section I: Post-Migration Student Data & Curriculum Preservation ---');
  try {
    const { data: postDoc } = await admin.from('documents').select('*').eq('id', documentId).single();
    const { data: postSub } = await admin.from('subjects').select('*').eq('id', subjectId).single();
    const { count: totalNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId);
    const { count: chapNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'chapter');
    const { count: topNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'topic');
    const { count: subNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'subtopic');

    assert(
      postDoc?.user_id === user1.id && postDoc?.processing_status === 'completed',
      'Addition 10a: Document bf81ec3d... ownership and status 100% preserved'
    );
    assert(
      postSub?.user_id === user1.id && postSub?.source_document_id === documentId,
      'Addition 10b: Subject 173b9439... ownership and document relationship 100% preserved'
    );
    assert(
      totalNodes === 120 && chapNodes === 14 && topNodes === 85 && subNodes === 21,
      `Addition 10c: Curriculum hierarchy completely intact: ${chapNodes} chapters, ${topNodes} topics, ${subNodes} subtopics = ${totalNodes} total nodes`
    );
  } catch (err) {
    assert(false, 'Section I', err.message);
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`  Security & Integrity Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runComprehensiveSecurityAndIntegritySuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
