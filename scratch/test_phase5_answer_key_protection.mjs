import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { QuizModel } from '../models/quiz-model.js';
import { QuizService } from '../services/quiz-service.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function authenticateStudent(email) {
  const admin = getSupabaseAdmin();
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email
  });
  if (linkErr) throw new Error(`Magic link error for ${email}: ${linkErr.message}`);

  const client = getSupabaseClient();
  const { data: sessData, error: sessErr } = await client.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink'
  });
  if (sessErr) throw new Error(`Verify OTP error for ${email}: ${sessErr.message}`);

  return {
    id: sessData.user.id,
    email: sessData.user.email,
    accessToken: sessData.session.access_token
  };
}

async function runAnswerKeyProtectionTests() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 5: Answer-Key Protection & Anti-Leakage Suite   ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function recordPass(desc) {
    passed++;
    console.log(`  ✅ [PASS] ${desc}`);
  }

  function recordFail(desc, details = '') {
    failed++;
    console.error(`  ❌ [FAIL] ${desc} ${details ? ': ' + details : ''}`);
  }

  // --------------------------------------------------------------------------
  // SECTION 1: STATIC SCHEMA & ARCHITECTURAL LEAKAGE AUDIT
  // --------------------------------------------------------------------------
  console.log('--- Section 1: Static SQL Architecture & Zero-Leakage Audit ---');
  const sqlPath = path.join(process.cwd(), 'database', '006_diagnostic_quizzes.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Audit 1: quiz_questions table must NOT contain correct_option or explanation columns
  const questionsTableMatch = sql.match(/CREATE TABLE IF NOT EXISTS public\.quiz_questions\s*\(([\s\S]*?)\);/);
  const questionsTableSql = questionsTableMatch ? questionsTableMatch[1] : '';
  const hasCorrectInQuestions = questionsTableSql.includes('correct_option');
  const hasExplanationInQuestions = questionsTableSql.includes('explanation');

  if (!hasCorrectInQuestions && !hasExplanationInQuestions) {
    recordPass('Audit 1: public.quiz_questions has NO correct_option or explanation columns (Zero physical storage in questions table)');
  } else {
    recordFail('Audit 1: public.quiz_questions still contains sensitive columns', `correct_option: ${hasCorrectInQuestions}, explanation: ${hasExplanationInQuestions}`);
  }

  // Audit 2: public.quiz_question_keys table exists with required columns and constraints
  const hasKeysTable = sql.includes('CREATE TABLE IF NOT EXISTS public.quiz_question_keys') &&
                       sql.includes('correct_option TEXT NOT NULL CHECK (correct_option IN (\'A\', \'B\', \'C\', \'D\'))') &&
                       sql.includes('explanation TEXT NOT NULL') &&
                       sql.includes('REFERENCES public.quiz_questions(id) ON DELETE CASCADE');
  if (hasKeysTable) {
    recordPass('Audit 2: public.quiz_question_keys table defined with foreign keys and CASCADE delete protection');
  } else {
    recordFail('Audit 2: public.quiz_question_keys table definition incomplete or missing');
  }

  // Audit 3: RLS on quiz_question_keys strictly requires attempt status = 'completed'
  const hasCompletedRls = sql.includes('CREATE POLICY "Users can view answer keys only for completed attempts" ON public.quiz_question_keys') &&
                          sql.includes('WHERE a.id = quiz_question_keys.attempt_id') &&
                          sql.includes('AND a.status = \'completed\'');
  if (hasCompletedRls) {
    recordPass('Audit 3: quiz_question_keys RLS policy strictly restricts read access to COMPLETED attempts');
  } else {
    recordFail('Audit 3: quiz_question_keys RLS policy does not condition on completed status');
  }

  // Audit 4: Secure Review View masks secrets when status <> 'completed'
  const hasMaskedView = sql.includes('CREATE OR REPLACE VIEW public.quiz_attempt_reviews') &&
                        sql.includes('WITH (security_invoker = true)') &&
                        sql.includes('CASE WHEN att.status = \'completed\' THEN k.correct_option ELSE NULL END AS correct_option') &&
                        sql.includes('CASE WHEN att.status = \'completed\' THEN k.explanation ELSE NULL END AS explanation');
  if (hasMaskedView) {
    recordPass('Audit 4: public.quiz_attempt_reviews view dynamically masks answer keys to NULL for in-progress attempts');
  } else {
    recordFail('Audit 4: public.quiz_attempt_reviews view does not mask in-progress secrets');
  }

  // Audit 5: Review RPC explicitly rejects in-progress attempts
  const hasReviewRpc = sql.includes('CREATE OR REPLACE FUNCTION public.get_quiz_attempt_review(') &&
                       sql.includes('IF v_attempt.status <> \'completed\' THEN') &&
                       sql.includes('RAISE EXCEPTION \'Quiz attempt % is still in progress. Review is only accessible after completion.\'');
  if (hasReviewRpc) {
    recordPass('Audit 5: get_quiz_attempt_review RPC explicitly rejects in-progress attempts with clear security exception');
  } else {
    recordFail('Audit 5: get_quiz_attempt_review RPC does not block in-progress review requests');
  }

  // Audit 6: Mutation guard trigger protects quiz_question_keys
  const hasKeyMutationGuard = sql.includes('ELSIF TG_TABLE_NAME = \'quiz_question_keys\' THEN') &&
                              sql.includes('RAISE EXCEPTION \'Direct modification of quiz question keys is prohibited\'') &&
                              sql.includes('CREATE TRIGGER trg_protect_quiz_question_keys');
  if (hasKeyMutationGuard) {
    recordPass('Audit 6: protect_quiz_sensitive_columns trigger guards public.quiz_question_keys against direct client mutation');
  } else {
    recordFail('Audit 6: Trigger guard missing for quiz_question_keys');
  }

  // Audit 7: Hardened SECURITY DEFINER Search Path (SET search_path = '')
  const hasEmptySearchPathSave = sql.includes('CREATE OR REPLACE FUNCTION public.save_quiz_attempt(') &&
                                 sql.includes('SECURITY DEFINER\nSET search_path = \'\'');
  const hasEmptySearchPathSubmit = sql.includes('CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(') &&
                                   sql.includes('SECURITY DEFINER\nSET search_path = \'\'');
  const hasEmptySearchPathReview = sql.includes('CREATE OR REPLACE FUNCTION public.get_quiz_attempt_review(') &&
                                   sql.includes('SECURITY DEFINER\nSET search_path = \'\'');
  const hasEmptySearchPathTrigger = sql.includes('CREATE OR REPLACE FUNCTION public.protect_quiz_sensitive_columns()') &&
                                    sql.includes('SET search_path = \'\'');

  if (hasEmptySearchPathSave && hasEmptySearchPathSubmit && hasEmptySearchPathReview && hasEmptySearchPathTrigger) {
    recordPass('Audit 7: All SECURITY DEFINER & trigger functions strictly set empty search path (SET search_path = \'\')');
  } else {
    recordFail('Audit 7: Some functions do not use SET search_path = \'\'',
      `save: ${hasEmptySearchPathSave}, submit: ${hasEmptySearchPathSubmit}, review: ${hasEmptySearchPathReview}, trigger: ${hasEmptySearchPathTrigger}`);
  }

  // Audit 8: submit_quiz_attempt strictly rejects completed AND abandoned attempts
  const hasStatusCheckCompleted = sql.includes('IF v_status = \'completed\' THEN') &&
                                  sql.includes('RAISE EXCEPTION \'Quiz attempt % has already been completed. Resubmission is prohibited.\'');
  const hasStatusCheckAbandoned = sql.includes('ELSIF v_status = \'abandoned\' THEN') &&
                                  sql.includes('RAISE EXCEPTION \'Quiz attempt % has been abandoned. Submitting an abandoned attempt is prohibited.\'');
  const hasStatusCheckInProgress = sql.includes('ELSIF v_status <> \'in_progress\' THEN') &&
                                   sql.includes('RAISE EXCEPTION \'Quiz attempt % is in invalid state "%" for submission; must be in_progress.\'');

  if (hasStatusCheckCompleted && hasStatusCheckAbandoned && hasStatusCheckInProgress) {
    recordPass('Audit 8: submit_quiz_attempt SQL strictly requires in_progress status and rejects both completed and abandoned attempts');
  } else {
    recordFail('Audit 8: submit_quiz_attempt SQL missing abandoned or in_progress status checks');
  }

  // --------------------------------------------------------------------------
  // SECTION 2: LIVE PRE-SUBMISSION ZERO-LEAKAGE VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: Live Pre-Submission Zero-Leakage Tests ---');
  const student1 = await authenticateStudent('manikantaanandam2563@gmail.com');
  const student2 = await authenticateStudent('evaluator.demo@gapfinder.ai');
  const subjectId = '173b9439-b3c2-42c5-9ac0-592bf50a6626';
  const documentId = 'bf81ec3d-78c1-43c5-b962-5dc6a9a01335';

  const userClient1 = getUserSupabaseClient(student1.accessToken);
  const userClient2 = getUserSupabaseClient(student2.accessToken);

  // 1. Direct Model & Service Generation Test (In-Process)
  const localQuiz = await QuizService.generateQuiz(student1, {
    subjectId,
    documentId,
    difficulty: 'easy',
    questionCount: 3
  });
  assert.strictEqual(localQuiz.success, true);
  const localAttempt = localQuiz.attempt;
  const localQuestions = localQuiz.questions;

  // Test 7: Active quiz payload strictly strips correctOption and explanation
  const hasLeakedInLocalPayload = localQuestions.some(q => q.correctOption !== undefined || q.correct_option !== undefined || q.explanation !== undefined);
  if (!hasLeakedInLocalPayload && localQuestions.length === 3) {
    recordPass('Test 7: Active quiz generation payload contains NO correctOption or explanation');
  } else {
    recordFail('Test 7: Generation payload leaked answer key');
  }

  // Test 8: Legitimate Question Retrieval via Model: Student can retrieve question text, options, and order
  const fetchedQuestions = await QuizModel.getQuestionsForAttempt(userClient1, localAttempt.id, student1.id);
  const hasOptionsAndText = fetchedQuestions.length === localQuestions.length &&
                            fetchedQuestions.every(q => q.question_text && Array.isArray(q.options) && q.options.length === 4);
  const hasKeysInFetched = fetchedQuestions.some(q => q.correct_option !== undefined || q.explanation !== undefined);
  if (hasOptionsAndText && !hasKeysInFetched) {
    recordPass('Test 8: Student successfully retrieves questions and 4 options, while correct_option and explanation are 100% absent');
  } else {
    recordFail('Test 8: Question retrieval failed or exposed answer key', `hasKeys: ${hasKeysInFetched}`);
  }

  // Test 9: Direct Supabase / PostgREST Query on quiz_questions has NO answer-key columns
  let directQuestionsLeak = false;
  try {
    const { data: directQ } = await userClient1
      .from('quiz_questions')
      .select('*')
      .eq('attempt_id', localAttempt.id);
    if (directQ && directQ.length > 0) {
      directQuestionsLeak = directQ.some(q => q.correct_option !== undefined || q.explanation !== undefined);
    }
  } catch (e) {}

  if (!directQuestionsLeak) {
    recordPass('Test 9: Direct Supabase SELECT on public.quiz_questions contains no correct_option or explanation');
  } else {
    recordFail('Test 9: Direct SELECT on quiz_questions exposed answer keys');
  }

  // Test 10: Direct Supabase / PostgREST Query on quiz_question_keys while in-progress yields 0 rows (RLS Guard)
  let inProgressKeysExposed = false;
  try {
    const { data: keysData } = await userClient1
      .from('quiz_question_keys')
      .select('*')
      .eq('attempt_id', localAttempt.id);

    if (keysData && keysData.length > 0) {
      inProgressKeysExposed = true;
    }
  } catch (e) {}

  if (!inProgressKeysExposed) {
    recordPass('Test 10: Direct Supabase SELECT on public.quiz_question_keys returns 0 rows during active in_progress quiz');
  } else {
    recordFail('Test 10: In-progress quiz leaked answer keys via public.quiz_question_keys');
  }

  // Test 11: In-Progress Review Rejection via Model
  let preReviewModelBlocked = false;
  try {
    await QuizModel.getAttemptReview(userClient1, localAttempt.id, student1.id);
  } catch (err) {
    if (err.message.includes('still in progress')) {
      preReviewModelBlocked = true;
    }
  }
  if (preReviewModelBlocked) {
    recordPass('Test 11: QuizModel.getAttemptReview strictly rejects in-progress attempts (pre-submission review blocked)');
  } else {
    recordFail('Test 11: In-progress attempt review was not rejected by model');
  }

  // Test 12: In-Progress Review Rejection via HTTP API
  const genHttpRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subjectId,
      difficulty: 'easy',
      questionCount: 3
    })
  });
  const httpQuiz = await genHttpRes.json();
  assert.strictEqual(httpQuiz.success, true);
  const httpAttempt = httpQuiz.attempt;

  const preReviewHttpRes = await fetch(`${BASE_URL}/api/quiz/review?attemptId=${encodeURIComponent(httpAttempt.id)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`
    }
  });
  const preReviewHttpJson = await preReviewHttpRes.json();
  if (preReviewHttpRes.status === 400 && preReviewHttpJson.error?.includes('in progress')) {
    recordPass('Test 12: GET /api/quiz/review strictly rejects in-progress attempts with HTTP 400');
  } else {
    recordFail('Test 12: GET /api/quiz/review did not reject in-progress attempt', JSON.stringify(preReviewHttpJson));
  }

  // --------------------------------------------------------------------------
  // SECTION 3: BACKEND EVALUATION & POST-SUBMISSION REVIEW ACCESS
  // --------------------------------------------------------------------------
  console.log('\n--- Section 3: Submission Evaluation & Post-Submission Review Access ---');

  // Test 13: Trusted backend retains access to answer keys strictly in server context
  const serverKeys = await QuizModel.getAnswerKeys(getSupabaseAdmin(), localAttempt.id, student1.id);
  if (serverKeys && serverKeys.length === localQuestions.length && serverKeys.every(k => k.correct_option)) {
    recordPass('Test 13: Trusted backend retains secure access to answer keys via QuizModel.getAnswerKeys');
  } else {
    recordFail('Test 13: Trusted backend could not retrieve secret keys for evaluation');
  }

  // Test 14: Submission evaluation calculates score and percentage strictly on server
  const answersToSubmit = localQuestions.map((q, idx) => ({
    questionId: q.id,
    selectedOption: idx === 0 ? serverKeys.find(k => k.question_id === q.id)?.correct_option : 'D'
  }));

  const localSubmit = await QuizService.submitQuiz(student1, {
    attemptId: localAttempt.id,
    answers: answersToSubmit
  });
  assert.strictEqual(localSubmit.success, true);
  assert.strictEqual(localSubmit.status, 'completed');

  if (localSubmit.score >= 0 && localSubmit.percentage >= 0) {
    recordPass(`Test 14: Submission evaluated by server (Score: ${localSubmit.score}/${localSubmit.totalQuestions}, ${localSubmit.percentage}%)`);
  } else {
    recordFail('Test 14: Submission evaluation failed to compute score');
  }

  // Test 15: Post-submission response delivers complete review with answer keys and explanations
  const hasCompletedReview = Array.isArray(localSubmit.review) &&
                             localSubmit.review.length === localQuestions.length &&
                             localSubmit.review.every(r => r.correctOption && r.explanation && r.sourceReference?.verified);
  if (hasCompletedReview) {
    recordPass('Test 15: Post-submission response delivers complete grounded review with correct answers, explanations, and citations');
  } else {
    recordFail('Test 15: Post-submission response missing correct answers, explanations, or citations');
  }

  // Test 16: Post-submission review retrieval via Model (QuizModel.getAttemptReview)
  const completedReviewModel = await QuizModel.getAttemptReview(userClient1, localAttempt.id, student1.id);
  if (completedReviewModel.success && completedReviewModel.review?.every(r => r.correctOption)) {
    recordPass('Test 16: Legitimate student can access full review including answer keys after completion');
  } else {
    recordFail('Test 16: Student could not access review after completion via model');
  }

  // Test 17: Post-submission review retrieval via HTTP API
  const httpSubmitRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      attemptId: httpAttempt.id,
      answers: httpQuiz.questions.map(q => ({ questionId: q.id, selectedOption: 'A' }))
    })
  });
  const httpSubmitJson = await httpSubmitRes.json();
  assert.strictEqual(httpSubmitJson.success, true);

  const postReviewHttpRes = await fetch(`${BASE_URL}/api/quiz/review?attemptId=${encodeURIComponent(httpAttempt.id)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`
    }
  });
  const postReviewHttpJson = await postReviewHttpRes.json();
  if (postReviewHttpRes.status === 200 && postReviewHttpJson.success && Array.isArray(postReviewHttpJson.review) && postReviewHttpJson.review.length > 0) {
    recordPass('Test 17: GET /api/quiz/review delivers verified review for completed attempt');
  } else {
    recordFail('Test 17: GET /api/quiz/review failed for completed attempt', JSON.stringify(postReviewHttpJson));
  }

  // --------------------------------------------------------------------------
  // SECTION 4: NEGATIVE SECURITY & ISOLATION TESTS
  // --------------------------------------------------------------------------
  console.log('\n--- Section 4: Negative Security & Cross-User Isolation Tests ---');

  // Test 18: Cross-User Review Access Blocked: Student 2 cannot access Student 1's completed review
  const crossReviewRes = await fetch(`${BASE_URL}/api/quiz/review?attemptId=${encodeURIComponent(httpAttempt.id)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student2.accessToken}`
    }
  });
  const crossReviewJson = await crossReviewRes.json();
  if (crossReviewRes.status === 400 && crossReviewJson.error?.includes('access denied')) {
    recordPass('Test 18: Cross-user review access blocked (Student 2 cannot review Student 1 attempt)');
  } else {
    recordFail('Test 18: Cross-user review access was not blocked', JSON.stringify(crossReviewJson));
  }

  // Test 19: Cross-User Model Isolation: Student 2 cannot access Student 1 questions or keys
  const crossQuestions = await QuizModel.getQuestionsForAttempt(userClient2, localAttempt.id, student2.id);
  const crossKeys = await QuizModel.getAnswerKeys(userClient2, localAttempt.id, student2.id);
  if (crossQuestions.length === 0 && crossKeys.length === 0) {
    recordPass('Test 19: Cross-user table queries return 0 rows under authenticated user isolation');
  } else {
    recordFail('Test 19: Cross-user table queries leaked rows to unauthorized student');
  }

  // Test 20: Unauthenticated Access Rejection
  const unauthReviewRes = await fetch(`${BASE_URL}/api/quiz/review?attemptId=${encodeURIComponent(httpAttempt.id)}`, {
    method: 'GET'
  });
  if (unauthReviewRes.status === 401) {
    recordPass('Test 20: Unauthenticated review request strictly rejected with 401 Unauthorized');
  } else {
    recordFail('Test 20: Unauthenticated review request was not rejected with 401');
  }

  // Test 21: Resubmission Prevention on Completed Attempt
  let resubmitBlocked = false;
  try {
    await QuizService.submitQuiz(student1, {
      attemptId: localAttempt.id,
      answers: answersToSubmit
    });
  } catch (err) {
    if (err.message.includes('already been submitted and completed')) {
      resubmitBlocked = true;
    }
  }
  if (resubmitBlocked) {
    recordPass('Test 21: Resubmission on completed attempt is strictly blocked (Tampering prevented)');
  } else {
    recordFail('Test 21: Completed attempt resubmission was not rejected');
  }

  // Test 22: Submission Prevention on Abandoned Attempt
  const abandonedQuiz = await QuizService.generateQuiz(student1, {
    subjectId,
    documentId,
    difficulty: 'easy',
    questionCount: 3
  });
  const abandonedAttempt = abandonedQuiz.attempt;
  // Mark the attempt as abandoned in memory / store
  const storedAbandoned = await QuizModel.getAttempt(userClient1, abandonedAttempt.id, student1.id);
  if (storedAbandoned) {
    storedAbandoned.status = 'abandoned';
  }

  let abandonedSubmitBlocked = false;
  try {
    await QuizService.submitQuiz(student1, {
      attemptId: abandonedAttempt.id,
      answers: abandonedQuiz.questions.map(q => ({ questionId: q.id, selectedOption: 'A' }))
    });
  } catch (err) {
    if (err.message.includes('abandoned')) {
      abandonedSubmitBlocked = true;
    }
  }
  if (abandonedSubmitBlocked) {
    recordPass('Test 22: Submission on abandoned attempt is strictly blocked (Rejecting abandoned attempts)');
  } else {
    recordFail('Test 22: Abandoned attempt submission was not rejected');
  }

  // --------------------------------------------------------------------------
  // SECTION 5: DATA PRESERVATION AUDIT
  // --------------------------------------------------------------------------
  console.log('\n--- Section 5: Student Data & Curriculum Preservation Audit ---');
  const adminClient = getSupabaseAdmin();

  // Document check
  const { data: postDoc, error: docErr } = await adminClient
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();

  const { count: actualChunks } = await adminClient
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', documentId);

  if (postDoc && postDoc.user_id === student1.id && postDoc.processing_status === 'completed' && actualChunks === 1068) {
    recordPass(`Preservation 1: Source document and all 1,068 chunks 100% intact`);
  } else {
    recordFail(`Preservation 1: Source document check failed`, docErr?.message);
  }

  // Subject check
  const { data: postSub, error: subErr } = await adminClient
    .from('subjects')
    .select('*')
    .eq('id', subjectId)
    .single();

  if (postSub && postSub.user_id === student1.id && postSub.source_document_id === documentId) {
    recordPass(`Preservation 2: Mathematics subject record and ownership 100% intact`);
  } else {
    recordFail(`Preservation 2: Mathematics subject check failed`, subErr?.message);
  }

  // Curriculum hierarchy check
  const { count: totalNodes } = await adminClient.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId);
  const { count: chapNodes } = await adminClient.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'chapter');
  const { count: topNodes } = await adminClient.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'topic');
  const { count: subNodes } = await adminClient.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'subtopic');

  if (totalNodes === 120 && chapNodes === 14 && topNodes === 85 && subNodes === 21) {
    recordPass(`Preservation 3: Verified 120-node curriculum hierarchy completely intact (14 chaps, 85 topics, 21 subtopics)`);
  } else {
    recordFail(`Preservation 3: Curriculum node count mismatch: ${totalNodes} total nodes`);
  }

  console.log('\n========================================================================');
  console.log(`  Answer-Key Protection Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAnswerKeyProtectionTests().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
