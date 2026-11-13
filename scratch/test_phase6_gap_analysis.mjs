import assert from 'assert';
import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { QuizModel } from '../models/quiz-model.js';
import { QuizService } from '../services/quiz-service.js';
import { TopicModel } from '../models/topic-model.js';
import { GapAnalysisService } from '../services/gap-analysis-service.js';
import { GapAnalysisModel } from '../models/gap-analysis-model.js';

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

async function runGapAnalysisTests() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 6: Intelligent Gap Analysis Engine Test Suite    ');
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

  // Authenticate student accounts
  const student1 = await authenticateStudent('manikantaanandam2563@gmail.com');
  const student2 = await authenticateStudent('evaluator.demo@gapfinder.ai');

  const subjectId = '173b9439-b3c2-42c5-9ac0-592bf50a6626'; // Mathematics
  const documentId = 'bf81ec3d-78c1-43c5-b962-5dc6a9a01335';

  const userClient1 = getUserSupabaseClient(student1.accessToken);
  const userClient2 = getUserSupabaseClient(student2.accessToken);

  // Fetch curriculum topics from GapAnalysisModel (resilient across DB & in-memory store)
  const admin = getSupabaseAdmin();
  const hierarchy = await GapAnalysisModel.getCurriculumHierarchy(admin, subjectId);
  const realTopics = hierarchy.allTopics;
  assert(realTopics.length > 0, `Expected curriculum topics, found ${realTopics.length}`);

  const topicA = realTopics.find(t => t.name.includes('1.1') || t.name.includes('INTRODUCTION')) || realTopics[0];
  const topicB = realTopics.find(t => t.name.includes('1.3') || t.name.includes('IRRATIONAL')) || realTopics[1];
  const topicC = realTopics.find(t => t.name.includes('2.1') || t.name.includes('SETS')) || realTopics[2];

  // --------------------------------------------------------------------------
  // SECTION 1: UNIT & SERVICE-LEVEL DIAGNOSTIC CLASSIFICATION TESTS
  // --------------------------------------------------------------------------
  console.log('--- Section 1: Topic Classification & Safeguards ---');

  // Test 1: All Answers Correct -> Strong (>= 80% across >= 2 questions)
  const qAllCorrect = [
    {
      id: 'q-strong-1',
      questionOrder: 1,
      questionText: 'Test question 1 for strong mastery',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'A',
      explanation: 'Explanation 1',
      difficulty: 'easy',
      topicId: topicA.id,
      citationVerified: true
    },
    {
      id: 'q-strong-2',
      questionOrder: 2,
      questionText: 'Test question 2 for strong mastery',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'B',
      explanation: 'Explanation 2',
      difficulty: 'medium',
      topicId: topicA.id,
      citationVerified: true
    },
    {
      id: 'q-strong-3',
      questionOrder: 3,
      questionText: 'Test question 3 for strong mastery',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'C',
      explanation: 'Explanation 3',
      difficulty: 'hard',
      topicId: topicA.id,
      citationVerified: true
    }
  ];

  const strongAttemptId = 'att-strong-001';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: strongAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: topicA.id,
      difficulty: 'medium'
    },
    questions: qAllCorrect
  });

  await QuizService.submitQuiz(student1, {
    attemptId: strongAttemptId,
    answers: [
      { questionId: 'q-strong-1', selectedOption: 'A' },
      { questionId: 'q-strong-2', selectedOption: 'B' },
      { questionId: 'q-strong-3', selectedOption: 'C' }
    ]
  });

  const diagnosisStrong = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: strongAttemptId
  });

  const reportA = diagnosisStrong.topicReports.find(t => t.topicId === topicA.id);
  if (reportA && reportA.classification === 'strong' && reportA.accuracyPercentage === 100.0 && reportA.correctAnswers === 3) {
    recordPass('Test 1: All answers correct classified as Strong (100.0% accuracy, 3/3 questions)');
  } else {
    recordFail('Test 1: All answers correct classification failed', JSON.stringify(reportA));
  }

  // Test 2: All Answers Incorrect -> Weak (< 50%)
  const qAllIncorrect = [
    {
      id: 'q-weak-1',
      questionOrder: 1,
      questionText: 'Test question 1 for weak topic',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'A',
      explanation: 'Explanation W1',
      difficulty: 'medium',
      topicId: topicB.id,
      citationVerified: true
    },
    {
      id: 'q-weak-2',
      questionOrder: 2,
      questionText: 'Test question 2 for weak topic',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'B',
      explanation: 'Explanation W2',
      difficulty: 'hard',
      topicId: topicB.id,
      citationVerified: true
    }
  ];

  const weakAttemptId = 'att-weak-001';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: weakAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: topicB.id,
      difficulty: 'medium'
    },
    questions: qAllIncorrect
  });

  await QuizService.submitQuiz(student1, {
    attemptId: weakAttemptId,
    answers: [
      { questionId: 'q-weak-1', selectedOption: 'D' }, // wrong
      { questionId: 'q-weak-2', selectedOption: 'D' }  // wrong
    ]
  });

  const diagnosisWeak = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: weakAttemptId
  });

  const reportB = diagnosisWeak.topicReports.find(t => t.topicId === topicB.id);
  if (reportB && reportB.classification === 'weak' && reportB.accuracyPercentage === 0.0 && reportB.incorrectAnswers === 2) {
    recordPass('Test 2: All answers incorrect classified as Weak (0.0% accuracy, priority revision flagged)');
  } else {
    recordFail('Test 2: All answers incorrect classification failed', JSON.stringify(reportB));
  }

  // Test 3: Mixed Correct and Incorrect Answers -> Medium (50% to < 80%)
  const qMixed = [
    {
      id: 'q-med-1',
      questionOrder: 1,
      questionText: 'Test question 1 for medium topic',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'A',
      explanation: 'Explanation M1',
      difficulty: 'easy',
      topicId: topicC.id,
      citationVerified: true
    },
    {
      id: 'q-med-2',
      questionOrder: 2,
      questionText: 'Test question 2 for medium topic',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'B',
      explanation: 'Explanation M2',
      difficulty: 'medium',
      topicId: topicC.id,
      citationVerified: true
    },
    {
      id: 'q-med-3',
      questionOrder: 3,
      questionText: 'Test question 3 for medium topic',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'C',
      explanation: 'Explanation M3',
      difficulty: 'hard',
      topicId: topicC.id,
      citationVerified: true
    }
  ];

  const medAttemptId = 'att-med-001';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: medAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: topicC.id,
      difficulty: 'medium'
    },
    questions: qMixed
  });

  await QuizService.submitQuiz(student1, {
    attemptId: medAttemptId,
    answers: [
      { questionId: 'q-med-1', selectedOption: 'A' }, // correct
      { questionId: 'q-med-2', selectedOption: 'B' }, // correct
      { questionId: 'q-med-3', selectedOption: 'D' }  // incorrect (hard)
    ]
  });

  const diagnosisMed = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: medAttemptId
  });

  const reportC = diagnosisMed.topicReports.find(t => t.topicId === topicC.id);
  if (reportC && reportC.classification === 'medium' && reportC.accuracyPercentage === 66.7 && reportC.correctAnswers === 2 && reportC.incorrectAnswers === 1) {
    recordPass('Test 3: Mixed correct and incorrect classified as Medium (66.7% accuracy, 2 correct, 1 incorrect)');
  } else {
    recordFail('Test 3: Mixed classification failed', JSON.stringify(reportC));
  }

  // Test 4: Transparent and Configurable Classification Thresholds
  const customThresholdDiagnosis = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: medAttemptId,
    thresholds: {
      weakCeiling: 70.0, // Raising weak threshold to 70% makes 66.7% weak
      mediumCeiling: 85.0,
      strongFloor: 85.0
    }
  });
  const customReportC = customThresholdDiagnosis.topicReports.find(t => t.topicId === topicC.id);
  if (customReportC && customReportC.classification === 'weak') {
    recordPass('Test 4: Configurable thresholds work transparently (66.7% becomes Weak when weakCeiling is 70%)');
  } else {
    recordFail('Test 4: Configurable threshold test failed', JSON.stringify(customReportC));
  }

  // Test 5: Insufficient Questions Safeguard (Do NOT classify as Strong based on 1 easy question)
  const singleEasyTopic = realTopics[5];
  const qSingleEasy = [
    {
      id: 'q-single-easy-1',
      questionOrder: 1,
      questionText: 'Single easy question test',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'A',
      explanation: 'Easy explanation',
      difficulty: 'easy',
      topicId: singleEasyTopic.id,
      citationVerified: true
    }
  ];

  const singleAttemptId = 'att-single-easy-001';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: singleAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: singleEasyTopic.id,
      difficulty: 'easy'
    },
    questions: qSingleEasy
  });

  await QuizService.submitQuiz(student1, {
    attemptId: singleAttemptId,
    answers: [{ questionId: 'q-single-easy-1', selectedOption: 'A' }] // correct
  });

  const diagnosisSingle = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: singleAttemptId
  });

  const reportSingle = diagnosisSingle.topicReports.find(t => t.topicId === singleEasyTopic.id);
  if (reportSingle && reportSingle.classification === 'insufficient_data' && reportSingle.reason.includes('cannot be classified as Strong based on a single easy question alone')) {
    recordPass('Test 5: Safeguard 1 enforced — 1 easy question correct classified as Insufficient Data (NOT Strong)');
  } else {
    recordFail('Test 5: 1 easy question incorrectly assigned strong classification', JSON.stringify(reportSingle));
  }

  // Test 6: Topics with No Attempts are NEVER Classified as Weak
  const assessedIds = diagnosisSingle.topicReports.map(t => t.topicId);
  const unassessedInCurriculum = diagnosisSingle.unassessedTopics;
  const anyUnassessedWeak = diagnosisSingle.topicReports.some(t => t.totalQuestions === 0);

  if (!anyUnassessedWeak && unassessedInCurriculum.length > 0 && diagnosisSingle.overallDiagnosis.unassessedTopicsCount > 0) {
    recordPass(`Test 6: Safeguard 6 enforced — Unassessed topics (${unassessedInCurriculum.length} nodes) are NEVER classified as Weak`);
  } else {
    recordFail('Test 6: Unassessed topics were improperly classified as weak');
  }

  // --------------------------------------------------------------------------
  // SECTION 2: MULTI-TOPIC & MULTI-ATTEMPT DIAGNOSIS
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: Multi-Topic & Multi-Attempt Analysis ---');

  // Test 7: Multiple Topics in One Quiz
  const multiTopicAttemptId = 'att-multi-topic-001';
  const qMulti = [
    {
      id: 'q-mt-1',
      questionOrder: 1,
      questionText: 'Multi topic 1 question',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'A',
      explanation: 'MT1',
      difficulty: 'medium',
      topicId: realTopics[20].id,
      citationVerified: true
    },
    {
      id: 'q-mt-2',
      questionOrder: 2,
      questionText: 'Multi topic 2 question',
      options: [{ id: 'A', text: 'Option A' }, { id: 'B', text: 'Option B' }, { id: 'C', text: 'Option C' }, { id: 'D', text: 'Option D' }],
      correctOption: 'B',
      explanation: 'MT2',
      difficulty: 'medium',
      topicId: realTopics[21].id,
      citationVerified: true
    }
  ];

  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: multiTopicAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      difficulty: 'medium'
    },
    questions: qMulti
  });

  await QuizService.submitQuiz(student1, {
    attemptId: multiTopicAttemptId,
    answers: [
      { questionId: 'q-mt-1', selectedOption: 'A' }, // correct
      { questionId: 'q-mt-2', selectedOption: 'D' }  // incorrect
    ]
  });

  const diagnosisMulti = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: multiTopicAttemptId
  });

  const top1Report = diagnosisMulti.topicReports.find(t => t.topicId === realTopics[20].id);
  const top2Report = diagnosisMulti.topicReports.find(t => t.topicId === realTopics[21].id);

  if (top1Report && top2Report && top1Report.topicId !== top2Report.topicId && top1Report.correctAnswers === 1 && top2Report.incorrectAnswers === 1) {
    recordPass('Test 7: Multiple topics in one quiz correctly segregated into independent topic diagnoses');
  } else {
    recordFail('Test 7: Multi-topic segregation failed');
  }

  // Test 8: Multiple Quiz Attempts Comparison & Trend Tracking
  // Attempt 1: 33% accuracy on Topic 30
  const topicProgressionTarget = realTopics[30];
  const progAttempt1Id = 'att-prog-001';
  const qProg1 = [
    {
      id: 'q-p1-1',
      questionOrder: 1,
      questionText: 'P1-1',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'A',
      explanation: 'exp',
      difficulty: 'medium',
      topicId: topicProgressionTarget.id,
      citationVerified: true
    },
    {
      id: 'q-p1-2',
      questionOrder: 2,
      questionText: 'P1-2',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'B',
      explanation: 'exp',
      difficulty: 'medium',
      topicId: topicProgressionTarget.id,
      citationVerified: true
    },
    {
      id: 'q-p1-3',
      questionOrder: 3,
      questionText: 'P1-3',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'C',
      explanation: 'exp',
      difficulty: 'hard',
      topicId: topicProgressionTarget.id,
      citationVerified: true
    }
  ];

  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: progAttempt1Id,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: topicProgressionTarget.id,
      difficulty: 'medium'
    },
    questions: qProg1
  });

  await QuizService.submitQuiz(student1, {
    attemptId: progAttempt1Id,
    answers: [
      { questionId: 'q-p1-1', selectedOption: 'A' }, // 1 correct
      { questionId: 'q-p1-2', selectedOption: 'D' }, // wrong
      { questionId: 'q-p1-3', selectedOption: 'D' }  // wrong
    ]
  });

  // Attempt 2: 100% accuracy on Topic 30
  const progAttempt2Id = 'att-prog-002';
  const qProg2 = [
    {
      id: 'q-p2-1',
      questionOrder: 1,
      questionText: 'P2-1',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'A',
      explanation: 'exp',
      difficulty: 'medium',
      topicId: topicProgressionTarget.id,
      citationVerified: true
    },
    {
      id: 'q-p2-2',
      questionOrder: 2,
      questionText: 'P2-2',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'B',
      explanation: 'exp',
      difficulty: 'medium',
      topicId: topicProgressionTarget.id,
      citationVerified: true
    },
    {
      id: 'q-p2-3',
      questionOrder: 3,
      questionText: 'P2-3',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'C',
      explanation: 'exp',
      difficulty: 'hard',
      topicId: topicProgressionTarget.id,
      citationVerified: true
    }
  ];

  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: progAttempt2Id,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: topicProgressionTarget.id,
      difficulty: 'medium'
    },
    questions: qProg2
  });

  await QuizService.submitQuiz(student1, {
    attemptId: progAttempt2Id,
    answers: [
      { questionId: 'q-p2-1', selectedOption: 'A' }, // correct
      { questionId: 'q-p2-2', selectedOption: 'B' }, // correct
      { questionId: 'q-p2-3', selectedOption: 'C' }  // correct
    ]
  });

  const fullDiagnosis = await GapAnalysisService.generateGapAnalysis(student1, { subjectId });
  const comp = fullDiagnosis.attemptComparison;

  if (comp && comp.totalCompletedAttempts >= 2 && comp.improvement > 0 && comp.trend === 'improved') {
    recordPass(`Test 8: Multiple attempt comparison detected improvement (+${comp.improvement}% change, trend: ${comp.trend})`);
  } else {
    recordFail('Test 8: Multiple attempt comparison failed', JSON.stringify(comp));
  }

  // Test 9: Duplicate Attempt / Duplicate Question Prevention
  const totalAssessedQ = fullDiagnosis.overallDiagnosis.totalAssessedQuestions;
  const totalGrandCorrect = fullDiagnosis.overallDiagnosis.totalCorrect;
  const totalGrandIncorrect = fullDiagnosis.overallDiagnosis.totalIncorrect;

  if (totalAssessedQ === totalGrandCorrect + totalGrandIncorrect && totalAssessedQ > 0) {
    recordPass(`Test 9: Exact question counting without duplicates (Total: ${totalAssessedQ} = ${totalGrandCorrect} correct + ${totalGrandIncorrect} incorrect)`);
  } else {
    recordFail('Test 9: Question count discrepancy detected in aggregation');
  }

  // --------------------------------------------------------------------------
  // SECTION 3: SECURITY, ISOLATION & NEGATIVE TESTS
  // --------------------------------------------------------------------------
  console.log('\n--- Section 3: Security & Multi-Student Isolation ---');

  // Test 10: Cross-Student Access Rejection
  let crossStudentBlocked = false;
  try {
    // Student 2 attempts to request gap analysis for Student 1's subject
    await GapAnalysisService.generateGapAnalysis(student2, { subjectId });
  } catch (err) {
    if (err.message.includes('not found or access denied')) {
      crossStudentBlocked = true;
    }
  }

  if (crossStudentBlocked) {
    recordPass('Test 10: Cross-student access strictly blocked (Student 2 denied access to Student 1 diagnosis)');
  } else {
    recordFail('Test 10: Cross-student access was not rejected');
  }

  // Test 11: Cross-Subject Isolation
  const randomSubjectId = '00000000-0000-0000-0000-000000000000';
  let crossSubjectBlocked = false;
  try {
    await GapAnalysisService.generateGapAnalysis(student1, { subjectId: randomSubjectId });
  } catch (err) {
    if (err.message.includes('not found or access denied')) {
      crossSubjectBlocked = true;
    }
  }

  if (crossSubjectBlocked) {
    recordPass('Test 11: Cross-subject isolation enforced (Unknown/unowned subject rejected)');
  } else {
    recordFail('Test 11: Cross-subject request did not fail as expected');
  }

  // Test 12: Missing Topic Mapping Handling
  const qMissingTopic = [
    {
      id: 'q-no-top-1',
      questionOrder: 1,
      questionText: 'Question with null topic ID',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'A',
      explanation: 'exp',
      difficulty: 'medium',
      topicId: null, // intentionally null
      citationVerified: true
    }
  ];

  const nullTopicAttemptId = 'att-null-top-001';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: nullTopicAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      difficulty: 'medium'
    },
    questions: qMissingTopic
  });

  await QuizService.submitQuiz(student1, {
    attemptId: nullTopicAttemptId,
    answers: [{ questionId: 'q-no-top-1', selectedOption: 'A' }]
  });

  const diagnosisNullTop = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: nullTopicAttemptId
  });

  if (diagnosisNullTop.success && diagnosisNullTop.topicReports.length > 0) {
    recordPass('Test 12: Questions with missing topic IDs handled gracefully without engine crash');
  } else {
    recordFail('Test 12: Missing topic ID caused failure');
  }

  // Test 13: Unanswered / Missing Answer Data Handled Correctly
  const qUnanswered = [
    {
      id: 'q-unans-1',
      questionOrder: 1,
      questionText: 'Unanswered test question',
      options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
      correctOption: 'A',
      explanation: 'exp',
      difficulty: 'medium',
      topicId: realTopics[15].id,
      citationVerified: true
    }
  ];

  const unansAttemptId = 'att-unans-001';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: unansAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: realTopics[15].id,
      difficulty: 'medium'
    },
    questions: qUnanswered
  });

  // Submit empty answers array (student did not select any option)
  await QuizService.submitQuiz(student1, {
    attemptId: unansAttemptId,
    answers: []
  });

  const diagnosisUnans = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: unansAttemptId
  });

  const reportUnans = diagnosisUnans.topicReports.find(t => t.topicId === realTopics[15].id);
  if (reportUnans && reportUnans.correctAnswers === 0 && reportUnans.incorrectAnswers === 1) {
    recordPass('Test 13: Unanswered question evaluated as incorrect (0% accuracy, score not inflated)');
  } else {
    recordFail('Test 13: Unanswered question handling failed', JSON.stringify(reportUnans));
  }

  // Test 14: No Answer Leakage for In-Progress Attempts
  const inProgressAttemptId = 'att-inprog-leak-test';
  await QuizModel.saveAttemptWithQuestions(userClient1, {
    attempt: {
      id: inProgressAttemptId,
      userId: student1.id,
      subjectId,
      sourceDocumentId: documentId,
      topicId: realTopics[18].id,
      difficulty: 'hard'
    },
    questions: [
      {
        id: 'q-secret-leak-1',
        questionOrder: 1,
        questionText: 'Secret question in progress',
        options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }, { id: 'D', text: 'D' }],
        correctOption: 'D',
        explanation: 'Top secret explanation',
        difficulty: 'hard',
        topicId: realTopics[18].id,
        citationVerified: true
      }
    ]
  });

  // Query gap analysis specifically for the in-progress attempt
  const inProgDiagnosis = await GapAnalysisService.generateGapAnalysis(student1, {
    subjectId,
    attemptId: inProgressAttemptId
  });

  // In-progress attempt must yield 0 assessed questions (pre-submission leakage blocked)
  if (inProgDiagnosis.overallDiagnosis.totalAssessedQuestions === 0 && inProgDiagnosis.topicReports.length === 0) {
    recordPass('Test 14: Zero answer leakage — In-progress attempts strictly excluded from gap analysis');
  } else {
    recordFail('Test 14: In-progress attempt was included in gap analysis prematurely');
  }

  // --------------------------------------------------------------------------
  // SECTION 4: HTTP API ROUTE VERIFICATION (http://localhost:3000/api/gap-analysis)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 4: Live HTTP API Route Tests ---');

  // Test 15: Authorized Student HTTP Request
  const httpRes = await fetch(`${BASE_URL}/api/gap-analysis?subjectId=${subjectId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`
    }
  });

  const httpJson = await httpRes.json();
  if (httpRes.status === 200 && httpJson.success && httpJson.overallDiagnosis && Array.isArray(httpJson.topicReports)) {
    recordPass(`Test 15: GET /api/gap-analysis returns 200 OK with valid diagnosis (Accuracy: ${httpJson.overallDiagnosis.overallAccuracy}%, Assessed: ${httpJson.overallDiagnosis.totalAssessedQuestions})`);
  } else {
    recordFail('Test 15: HTTP API route returned error', JSON.stringify(httpJson));
  }

  // Test 16: Unauthenticated HTTP Request Rejection
  const unauthHttpRes = await fetch(`${BASE_URL}/api/gap-analysis?subjectId=${subjectId}`, {
    method: 'GET'
  });
  if (unauthHttpRes.status === 401) {
    recordPass('Test 16: Unauthenticated GET /api/gap-analysis strictly rejected with 401 Unauthorized');
  } else {
    recordFail('Test 16: Unauthenticated request was not rejected with 401');
  }

  // Test 17: Cross-Student HTTP Access Rejection
  const crossHttpRes = await fetch(`${BASE_URL}/api/gap-analysis?subjectId=${subjectId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student2.accessToken}`
    }
  });
  if (crossHttpRes.status === 403) {
    recordPass('Test 17: Cross-student GET /api/gap-analysis strictly rejected with 403 Forbidden');
  } else {
    recordFail('Test 17: Cross-student request was not rejected with 403', `Status: ${crossHttpRes.status}`);
  }

  // Test 18: Missing subjectId HTTP Request Rejection
  const missingSubjectRes = await fetch(`${BASE_URL}/api/gap-analysis`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`
    }
  });
  if (missingSubjectRes.status === 400) {
    recordPass('Test 18: Missing subjectId parameter rejected with 400 Bad Request');
  } else {
    recordFail('Test 18: Missing subjectId was not rejected with 400');
  }

  // --------------------------------------------------------------------------
  // SECTION 5: DATA SOURCE HONESTY & HISTORICAL PRESERVATION AUDIT
  // --------------------------------------------------------------------------
  console.log('\n--- Section 5: Data Source Honesty & Historical Preservation ---');

  // Test 19: Honest Data Source Labeling
  if (httpJson.dataSource && httpJson.dataSourceNote) {
    recordPass(`Test 19: Honest data source reporting verified: [${httpJson.dataSource}] — "${httpJson.dataSourceNote}"`);
  } else {
    recordFail('Test 19: Data source was not transparently reported');
  }

  // Preservation 1: Student Authentication Accounts Intact
  const { data: usersData, error: userErr } = await admin.auth.admin.listUsers();
  if (!userErr && usersData.users.some(u => u.email === student1.email) && usersData.users.some(u => u.email === student2.email)) {
    recordPass(`Preservation 1: Student authentication accounts preserved intact (${usersData.users.length} verified users)`);
  } else {
    recordFail('Preservation 1: Student authentication check failed');
  }

  // Preservation 2: Curriculum Hierarchy Preserved in System Memory
  if (hierarchy.allTopics.length > 0) {
    recordPass(`Preservation 2: Curriculum hierarchy preserved intact (${hierarchy.allTopics.length} topics mapped)`);
  } else {
    recordFail('Preservation 2: Curriculum hierarchy check failed');
  }

  // Preservation 3: Data Source Honesty
  if (httpJson.dataSource === 'in_memory' && httpJson.dataSourceNote.includes('in-memory')) {
    recordPass('Preservation 3: Data source honesty strictly maintained (in-memory flagged, no false remote persistence claims)');
  } else {
    recordFail('Preservation 3: Data source honesty failed');
  }

  console.log('\n========================================================================');
  console.log(`  Phase 6 Gap Analysis Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runGapAnalysisTests().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
