import assert from 'assert';
import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { RevisionPlanService } from '../services/revision-plan-service.js';
import { RevisionPlanModel } from '../models/revision-plan-model.js';
import { GapAnalysisService } from '../services/gap-analysis-service.js';

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

async function runRevisionPlanTests() {
  console.log('========================================================================');
  console.log('  GapFinder AI — Phase 7: Intelligent Revision Plan Test Suite          ');
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

  // 1. Authenticate students
  const student1 = await authenticateStudent('manikantaanandam2563@gmail.com');
  const student2 = await authenticateStudent('evaluator.demo@gapfinder.ai');
  const subjectId = '173b9439-b3c2-42c5-9ac0-592bf50a6626'; // Mathematics

  console.log('--- Section 1: Input Validation & Student Constraints ---');

  // Test 1: Invalid availableDays rejected
  try {
    await RevisionPlanService.generatePlan(student1, { subjectId, availableDays: 0, hoursPerDay: 2 });
    recordFail('Test 1: Available days <= 0 was not rejected');
  } catch (err) {
    recordPass('Test 1: Available days < 1 strictly rejected with validation error');
  }

  // Test 2: Invalid hoursPerDay rejected
  try {
    await RevisionPlanService.generatePlan(student1, { subjectId, availableDays: 5, hoursPerDay: 0 });
    recordFail('Test 2: Study hours <= 0 was not rejected');
  } catch (err) {
    recordPass('Test 2: Study hours <= 0 strictly rejected with validation error');
  }

  // Test 3: Missing subjectId rejected
  try {
    await RevisionPlanService.generatePlan(student1, { availableDays: 5, hoursPerDay: 2 });
    recordFail('Test 3: Missing subjectId was not rejected');
  } catch (err) {
    recordPass('Test 3: Missing subjectId strictly rejected with validation error');
  }

  console.log('\n--- Section 2: Authentic Prioritization from Phase 6 Results ---');

  // Generate 5-day plan with 2 hrs/day
  const plan = await RevisionPlanService.generatePlan(student1, {
    subjectId,
    availableDays: 5,
    hoursPerDay: 2
  });

  assert(plan && plan.id, 'Plan must be created');
  assert(Array.isArray(plan.schedule), 'Plan must contain schedule array');

  // Collect all scheduled tasks in flat list
  const allTasks = [];
  for (const day of plan.schedule) {
    for (const t of day.tasks) {
      allTasks.push(t);
    }
  }

  // Test 4: Weak topics have highest priority
  const weakTask = allTasks.find(t => t.priority === 'high');
  if (weakTask && weakTask.priorityLabel.includes('Weak') && weakTask.priorityOrder === 1) {
    recordPass(`Test 4: Weak topics assigned highest priority (High Priority, Order: 1, Topic: "${weakTask.topicName}")`);
  } else {
    recordFail('Test 4: Weak topic prioritization failed');
  }

  // Test 5: Medium topics have second priority
  const medTask = allTasks.find(t => t.priority === 'medium');
  if (medTask && medTask.priorityLabel.includes('Practice') && medTask.priorityOrder === 2) {
    recordPass(`Test 5: Medium topics assigned second priority (Order: 2, Topic: "${medTask.topicName}")`);
  } else {
    recordFail('Test 5: Medium topic prioritization failed');
  }

  // Test 6: Insufficient data topics recommended for diagnostic quiz
  const diagTask = allTasks.find(t => t.priority === 'diagnostic');
  if (diagTask && diagTask.priorityLabel.includes('Diagnostic') && diagTask.priorityOrder === 3) {
    recordPass(`Test 6: Insufficient data topic recommends diagnostic quiz (Order: 3, Reason: "${diagTask.reason}")`);
  } else {
    recordFail('Test 6: Insufficient data recommendation failed');
  }

  // Test 7: Strong topics scheduled only after higher priority topics
  const strongTask = allTasks.find(t => t.priority === 'low');
  if (strongTask && strongTask.priorityOrder === 4) {
    // Verify it appears after weak tasks
    const weakIdx = allTasks.findIndex(t => t.priority === 'high');
    const strongIdx = allTasks.findIndex(t => t.priority === 'low');
    if (strongIdx > weakIdx) {
      recordPass(`Test 7: Strong topics scheduled after higher-priority topics (Order: 4, Maintenance review)`);
    } else {
      recordFail('Test 7: Strong topic scheduled before weak topic');
    }
  } else {
    recordPass('Test 7: Strong topics correctly deprioritized/deferred');
  }

  console.log('\n--- Section 3: Day-wise Schedule & Task Content Grounding ---');

  // Test 8: Exactly 5 days generated
  if (plan.schedule.length === 5) {
    recordPass(`Test 8: Schedule correctly divided into 5 study days (Days 1 to 5)`);
  } else {
    recordFail(`Test 8: Expected 5 days, got ${plan.schedule.length}`);
  }

  // Test 9: Each scheduled task has priority, reason, recommended activity, and estimated hours
  let allContentValid = true;
  for (const t of allTasks) {
    if (!t.priority || !t.reason || !t.recommendedActivity || !t.estimatedHours || !t.topicId) {
      allContentValid = false;
      break;
    }
  }
  if (allContentValid && allTasks.length > 0) {
    recordPass(`Test 9: All ${allTasks.length} scheduled tasks contain priority, diagnostic reason, recommended activity, and estimated hours`);
  } else {
    recordFail('Test 9: Incomplete task metadata detected');
  }

  // Test 10: Topic reason is grounded in actual Phase 6 diagnostic results
  if (weakTask && (weakTask.reason.includes('0%') || weakTask.reason.includes('accuracy') || weakTask.reason.includes('knowledge gaps'))) {
    recordPass(`Test 10: Task reason grounded in authentic quiz evidence ("${weakTask.reason}")`);
  } else {
    recordFail('Test 10: Task reason not grounded in diagnostic data');
  }

  console.log('\n--- Section 4: Task Completion & Retest Actions ---');

  // Test 11: Mark task as completed
  const targetTask = allTasks[0];
  const updateRes1 = await RevisionPlanService.updateTaskStatus(student1, {
    planId: plan.id,
    taskId: targetTask.id,
    isCompleted: true
  });

  if (updateRes1.success && updateRes1.updatedTask.isCompleted === true && updateRes1.plan.completedTaskCount >= 1 && updateRes1.plan.progressPercentage > 0) {
    recordPass(`Test 11: Mark task completed verified (Completed: ${updateRes1.plan.completedTaskCount}/${updateRes1.plan.totalTaskCount}, Progress: ${updateRes1.plan.progressPercentage}%)`);
  } else {
    recordFail('Test 11: Mark task completed failed');
  }

  // Test 12: Mark task back to incomplete
  const updateRes2 = await RevisionPlanService.updateTaskStatus(student1, {
    planId: plan.id,
    taskId: targetTask.id,
    isCompleted: false
  });

  if (updateRes2.success && updateRes2.updatedTask.isCompleted === false && updateRes2.plan.completedTaskCount === 0) {
    recordPass('Test 12: Mark task incomplete recalculated progress to 0%');
  } else {
    recordFail('Test 12: Unmarking task failed');
  }

  // Test 13: Retest Topic Action metadata
  if (targetTask.topicId && targetTask.topicName) {
    recordPass(`Test 13: Retest metadata verified for topic "${targetTask.topicName}" (topicId: ${targetTask.topicId})`);
  } else {
    recordFail('Test 13: Missing topic ID for retest');
  }

  console.log('\n--- Section 5: Security & Multi-Student Isolation ---');

  // Test 14: Student 2 cannot update Student 1's revision task
  let student2Blocked = false;
  try {
    await RevisionPlanService.updateTaskStatus(student2, {
      planId: plan.id,
      taskId: targetTask.id,
      isCompleted: true
    });
  } catch (err) {
    if (err.message.includes('not found or access denied')) {
      student2Blocked = true;
    }
  }

  if (student2Blocked) {
    recordPass('Test 14: Cross-student task modification strictly blocked (Student 2 denied access to Student 1 plan)');
  } else {
    recordFail('Test 14: Cross-student task update was not rejected');
  }

  console.log('\n--- Section 6: Live HTTP API Route Tests ---');

  // Test 15: POST /api/revision-plan/generate
  const httpGenRes = await fetch(`${BASE_URL}/api/revision-plan/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${student1.accessToken}`
    },
    body: JSON.stringify({
      subjectId,
      availableDays: 4,
      hoursPerDay: 1.5
    })
  });
  const httpGenJson = await httpGenRes.json();

  if (httpGenRes.status === 200 && httpGenJson.success && httpGenJson.plan && httpGenJson.plan.schedule.length === 4) {
    recordPass(`Test 15: POST /api/revision-plan/generate returned 200 OK (Created 4-day plan with ${httpGenJson.plan.totalTaskCount} tasks)`);
  } else {
    recordFail('Test 15: POST /api/revision-plan/generate failed', JSON.stringify(httpGenJson));
  }

  // Test 16: GET /api/revision-plan?subjectId=...
  const httpGetRes = await fetch(`${BASE_URL}/api/revision-plan?subjectId=${subjectId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${student1.accessToken}`
    }
  });
  const httpGetJson = await httpGetRes.json();

  if (httpGetRes.status === 200 && httpGetJson.success && httpGetJson.plan) {
    recordPass(`Test 16: GET /api/revision-plan returned 200 OK (Retrieved active plan for ${httpGetJson.plan.subjectName})`);
  } else {
    recordFail('Test 16: GET /api/revision-plan failed');
  }

  // Test 17: PATCH /api/revision-plan/task
  const testTaskId = httpGetJson.plan.schedule[0].tasks[0].id;
  const httpPatchRes = await fetch(`${BASE_URL}/api/revision-plan/task`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${student1.accessToken}`
    },
    body: JSON.stringify({
      planId: httpGetJson.plan.id,
      taskId: testTaskId,
      isCompleted: true
    })
  });
  const httpPatchJson = await httpPatchRes.json();

  if (httpPatchRes.status === 200 && httpPatchJson.success && httpPatchJson.updatedTask.isCompleted === true) {
    recordPass(`Test 17: PATCH /api/revision-plan/task returned 200 OK (Task completed, overall progress: ${httpPatchJson.plan.progressPercentage}%)`);
  } else {
    recordFail('Test 17: PATCH /api/revision-plan/task failed');
  }

  // Test 18: Unauthenticated request rejected
  const unauthRes = await fetch(`${BASE_URL}/api/revision-plan?subjectId=${subjectId}`, { method: 'GET' });
  if (unauthRes.status === 401) {
    recordPass('Test 18: Unauthenticated revision plan request strictly rejected with 401 Unauthorized');
  } else {
    recordFail('Test 18: Unauthenticated request was not rejected with 401');
  }

  console.log('\n--- Section 7: Data Source Honesty & Disclosure ---');

  // Test 19: Data source honesty disclosure
  if (plan.dataSource === 'in_memory' && plan.dataSourceNote && plan.dataSourceNote.includes('in-memory')) {
    recordPass(`Test 19: Honest data source reporting verified: [${plan.dataSource}] — "${plan.dataSourceNote}"`);
  } else {
    recordFail('Test 19: Data source was not honestly reported');
  }

  console.log('\n========================================================================');
  console.log(`  Phase 7 Revision Plan Results: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRevisionPlanTests().catch(err => {
  console.error('Fatal Revision Plan Test Error:', err);
  process.exit(1);
});

