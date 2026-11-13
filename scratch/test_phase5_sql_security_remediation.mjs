import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { QuizService } from '../services/quiz-service.js';
import { QuizModel } from '../models/quiz-model.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function authenticateUser(email) {
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

async function runSqlSecurityRemediationTests() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 5: SQL Security Remediation Test Suite          ');
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
  // SECTION 1: Static SQL Verification of 006_diagnostic_quizzes.sql
  // --------------------------------------------------------------------------
  console.log('--- Section 1: SQL Schema & RPC Security Audit ---');
  const sqlPath = path.join(process.cwd(), 'database', '006_diagnostic_quizzes.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // Check 1: No insecure authentication fallback
  const hasInsecureFallback = sqlContent.includes("v_user_id := (p_attempt->>'user_id')") ||
                              sqlContent.includes("v_user_id := p_user_id");
  if (!hasInsecureFallback && sqlContent.includes("v_user_id := auth.uid();") && sqlContent.includes("IF v_user_id IS NULL THEN\n        RAISE EXCEPTION 'Unauthorized")) {
    recordPass('Fix 1: Insecure auth fallbacks completely removed; auth.uid() strictly required');
  } else {
    recordFail('Fix 1: Insecure auth fallbacks still present in SQL');
  }

  // Check 2: submit_quiz_attempt has NO p_score or p_percentage in parameters
  const submitFnMatch = sqlContent.match(/FUNCTION\s+public\.submit_quiz_attempt\s*\(([\s\S]*?)\)/i);
  const submitParams = submitFnMatch ? submitFnMatch[1] : '';
  const hasClientScoreParams = submitParams.includes('p_score') || submitParams.includes('p_percentage') || submitParams.includes('p_user_id');
  if (!hasClientScoreParams && submitParams.includes('p_attempt_id') && submitParams.includes('p_answers')) {
    recordPass('Fix 2: Client-controlled scoring removed from submit_quiz_attempt signature');
  } else {
    recordFail('Fix 2: submit_quiz_attempt still accepts client score/percentage parameters');
  }

  // Check 3: Database calculates correctness from stored questions
  const hasDbScoring = sqlContent.includes('SELECT correct_option INTO v_correct_option') &&
                       sqlContent.includes('v_is_correct := (v_selected_option IS NOT NULL AND v_selected_option = v_correct_option);') &&
                       sqlContent.includes('v_score := v_score + 1;');
  if (hasDbScoring) {
    recordPass('Fix 3: PostgreSQL calculates is_correct, score, and percentage internally');
  } else {
    recordFail('Fix 3: Internal database scoring logic missing from SQL');
  }

  // Check 4: save_quiz_attempt relationship validations
  const hasSubjectVal = sqlContent.includes('SELECT 1 FROM public.subjects\n        WHERE id = v_subject_id AND user_id = v_user_id');
  const hasDocVal = sqlContent.includes('SELECT 1 FROM public.documents\n            WHERE id = v_source_doc_id AND user_id = v_user_id');
  const hasTopicVal = sqlContent.includes('SELECT 1 FROM public.topics\n            WHERE id = v_topic_id AND subject_id = v_subject_id AND user_id = v_user_id');
  const hasChunkVal = sqlContent.includes('SELECT 1 FROM public.document_chunks\n                WHERE id = v_q_chunk_id');
  if (hasSubjectVal && hasDocVal && hasTopicVal && hasChunkVal) {
    recordPass('Fix 4: save_quiz_attempt validates subject, doc, topic, and chunk relationships');
  } else {
    recordFail('Fix 4: Relationship validation missing in save_quiz_attempt');
  }

  // Check 5: Sensitive field mutation protection trigger
  const hasTrigger = sqlContent.includes('protect_quiz_sensitive_columns') &&
                     sqlContent.includes('Direct modification of quiz attempt score') &&
                     sqlContent.includes('Direct modification of quiz question correct_option');
  if (hasTrigger) {
    recordPass('Fix 5: Direct UPDATE trigger protects sensitive columns');
  } else {
    recordFail('Fix 5: Sensitive column protection trigger missing');
  }

  // Check 6: RLS & Permissions
  const hasRevokePublic = sqlContent.includes('REVOKE ALL ON public.quiz_attempts FROM PUBLIC, anon;') &&
                          sqlContent.includes('REVOKE ALL ON public.quiz_questions FROM PUBLIC, anon;') &&
                          sqlContent.includes('REVOKE ALL ON public.quiz_answers FROM PUBLIC, anon;');
  const hasNoClientQuestionUpdate = !sqlContent.includes('GRANT UPDATE ON public.quiz_questions TO authenticated;') &&
                                    !sqlContent.includes('GRANT INSERT ON public.quiz_questions TO authenticated;');
  if (hasRevokePublic && hasNoClientQuestionUpdate) {
    recordPass('Fix 6: Table grants strictly restricted (direct question/answer mutations revoked)');
  } else {
    recordFail('Fix 6: Permissive grants detected on sensitive tables');
  }

  // Check 7: SECURITY DEFINER with safe search_path and restricted execute
  const hasSafePath = sqlContent.includes('SECURITY DEFINER\nSET search_path = public, pg_temp') ||
                      sqlContent.includes('SECURITY DEFINER\r\nSET search_path = public, pg_temp');
  const hasRestrictedExec = sqlContent.includes('REVOKE ALL ON FUNCTION public.save_quiz_attempt') &&
                            sqlContent.includes('GRANT EXECUTE ON FUNCTION public.save_quiz_attempt(JSONB, JSONB) TO authenticated, service_role;') &&
                            sqlContent.includes('GRANT EXECUTE ON FUNCTION public.submit_quiz_attempt(UUID, JSONB) TO authenticated, service_role;');
  if (hasSafePath && hasRestrictedExec) {
    recordPass('Fix 7: SECURITY DEFINER hardened with safe search_path and restricted role grants');
  } else {
    recordFail('Fix 7: Insecure search_path or public execution grants on RPCs');
  }

  // Check 8: Constraints on options array and question order
  const hasOptionsCheck = sqlContent.includes('CONSTRAINT ck_quiz_questions_options_array') &&
                          sqlContent.includes('jsonb_array_length(options) = 4');
  const hasOrderCheck = sqlContent.includes('CONSTRAINT uq_quiz_questions_attempt_order UNIQUE (attempt_id, question_order)');
  if (hasOptionsCheck && hasOrderCheck) {
    recordPass('Fix 8: Database constraints enforce 4-option array and unique question ordering');
  } else {
    recordFail('Fix 8: Option array or question order constraints missing');
  }

  // Check 9: Cross-attempt question injection validation
  const hasCrossAttemptCheck = sqlContent.includes('SELECT correct_option INTO v_correct_option\n            FROM public.quiz_questions\n            WHERE id = v_q_id AND attempt_id = p_attempt_id AND user_id = v_user_id;');
  if (hasCrossAttemptCheck) {
    recordPass('Fix 9: submit_quiz_attempt validates question belongs to same attempt & student');
  } else {
    recordFail('Fix 9: Cross-attempt question validation missing in submission loop');
  }

  // Check 10: Citation snapshot & delete resilience
  const hasSnapshotCol = sqlContent.includes('citation_snapshot JSONB NOT NULL DEFAULT') &&
                         sqlContent.includes('source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL') &&
                         sqlContent.includes('source_chunk_id UUID REFERENCES public.document_chunks(id) ON DELETE SET NULL');
  if (hasSnapshotCol) {
    recordPass('Fix 10: citation_snapshot and ON DELETE SET NULL preserve historical reviews');
  } else {
    recordFail('Fix 10: Historical review preservation schema missing');
  }

  // --------------------------------------------------------------------------
  // SECTION 2: Dynamic Live Multi-Account & API Security Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: Live API & Student Isolation Verification ---');
  const user1 = await authenticateUser('manikantaanandam2563@gmail.com');
  const user2 = await authenticateUser('evaluator.demo@gapfinder.ai');

  const subjectId = '173b9439-b3c2-42c5-9ac0-592bf50a6626';
  const documentId = 'bf81ec3d-78c1-43c5-b962-5dc6a9a01335';

  // Test 1: Anonymous API calls are rejected
  const anonRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectId })
  });
  if (anonRes.status === 401) {
    recordPass('Test 1: Anonymous API calls strictly rejected with HTTP 401');
  } else {
    recordFail('Test 1: Anonymous call not rejected with 401', `Status: ${anonRes.status}`);
  }

  // Test 2: Supplied user ID in body cannot impersonate another student
  const spoofUserRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user2.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subjectId: subjectId, // Account 1's subject
      userId: user1.id      // Attempting to impersonate Account 1!
    })
  });
  const spoofUserJson = await spoofUserRes.json();
  if (spoofUserRes.status === 400 && spoofUserJson.error?.includes('access denied')) {
    recordPass('Test 2: Supplied client userId cannot impersonate another student');
  } else {
    recordFail('Test 2: User impersonation was not blocked', JSON.stringify(spoofUserJson));
  }

  // Test 3: Account 2 cannot create attempt against Account 1's subject/document
  const crossSubjectRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user2.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subjectId: subjectId,
      documentId: documentId
    })
  });
  if (crossSubjectRes.status === 400) {
    recordPass("Test 3: Student cannot create an attempt against another student's subject");
  } else {
    recordFail('Test 3: Cross-student subject access was not blocked');
  }

  // Generate valid quiz for Account 1 to test submission security
  const genRes = await fetch(`${BASE_URL}/api/quiz/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subjectId: subjectId,
      difficulty: 'easy',
      questionCount: 2
    })
  });
  const quiz = await genRes.json();
  const attempt = quiz.attempt;
  const q1 = quiz.questions[0];
  const q2 = quiz.questions[1];

  // Test 4: Client-supplied score and is_correct cannot manipulate results
  const spoofScoreRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      attemptId: attempt.id,
      score: 99999,      // Injected fake score!
      percentage: 100.0, // Injected fake percentage!
      answers: [
        { questionId: q1.id, selectedOption: 'A', is_correct: true },
        { questionId: q2.id, selectedOption: 'B', is_correct: true }
      ]
    })
  });
  const submitJson = await spoofScoreRes.json();
  if (submitJson.success && submitJson.score !== 99999) {
    recordPass('Test 4: Client-supplied score and is_correct cannot manipulate evaluation results');
  } else {
    recordFail('Test 4: Spoofed score was accepted by server', JSON.stringify(submitJson));
  }

  // Test 5: Completed attempt cannot be resubmitted
  const resubmitRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      attemptId: attempt.id,
      answers: []
    })
  });
  const resubmitJson = await resubmitRes.json();
  if (resubmitRes.status === 400 && resubmitJson.error?.includes('already been submitted and completed')) {
    recordPass('Test 5: Completed attempt cannot be resubmitted (strictly locked)');
  } else {
    recordFail('Test 5: Completed attempt resubmission was not blocked', JSON.stringify(resubmitJson));
  }

  // Test 6: Cross-attempt question injection
  const freshGen = await fetch(`${BASE_URL}/api/quiz/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subjectId: subjectId,
      difficulty: 'easy',
      questionCount: 2
    })
  });
  const freshQuiz = await freshGen.json();
  const freshAttempt = freshQuiz.attempt;

  // Submit with an injected foreign question ID
  const foreignRes = await fetch(`${BASE_URL}/api/quiz/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${user1.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      attemptId: freshAttempt.id,
      answers: [
        { questionId: '00000000-0000-0000-0000-000000000000', selectedOption: 'A' },
        { questionId: freshQuiz.questions[0].id, selectedOption: 'A' }
      ]
    })
  });
  const foreignJson = await foreignRes.json();
  if (foreignJson.success && foreignJson.totalQuestions === 2 && foreignJson.review.every(r => r.questionId !== '00000000-0000-0000-0000-000000000000')) {
    recordPass('Test 6: Cross-attempt question injection is strictly rejected / filtered');
  } else {
    recordFail('Test 6: Foreign question was injected into evaluation', JSON.stringify(foreignJson));
  }

  // --------------------------------------------------------------------------
  // SECTION 3: Final Student Data & Curriculum Preservation
  // --------------------------------------------------------------------------
  console.log('\n--- Section 3: Student Data & Curriculum Preservation ---');
  const admin = getSupabaseAdmin();
  const { data: doc } = await admin.from('documents').select('*').eq('id', documentId).single();
  const { count: chunkCount } = await admin.from('document_chunks').select('*', { count: 'exact', head: true }).eq('document_id', documentId);
  const { data: sub } = await admin.from('subjects').select('*').eq('id', subjectId).single();
  const { count: totalNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId);
  const { count: chapNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'chapter');
  const { count: topNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'topic');
  const { count: subNodes } = await admin.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId).eq('hierarchy_level', 'subtopic');

  if (doc?.id === documentId && doc.user_id === user1.id && doc.processing_status === 'completed' && chunkCount === 1068) {
    recordPass('Preservation 1: Source document and 1,068 chunks 100% intact');
  } else {
    recordFail('Preservation 1: Document or chunks corrupted');
  }

  if (sub?.id === subjectId && sub.user_id === user1.id && sub.source_document_id === documentId) {
    recordPass('Preservation 2: Mathematics subject record and ownership 100% intact');
  } else {
    recordFail('Preservation 2: Subject record corrupted');
  }

  if (totalNodes === 120 && chapNodes === 14 && topNodes === 85 && subNodes === 21) {
    recordPass('Preservation 3: 120-node curriculum hierarchy completely intact (14 chaps, 85 topics, 21 subtopics)');
  } else {
    recordFail('Preservation 3: Curriculum node counts corrupted');
  }

  console.log('\n========================================================================');
  console.log(`  Remediation Test Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runSqlSecurityRemediationTests().catch(err => {
  console.error('Test Suite Exception:', err);
  process.exit(1);
});

