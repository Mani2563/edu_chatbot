import { getSupabaseClient, getUserSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';
import { DocumentService } from '../services/document-service.js';
import { DocumentModel } from '../models/document-model.js';
import { TopicModel } from '../models/topic-model.js';
import crypto from 'crypto';

async function testDeletionSafety() {
  console.log('=== GapFinder AI: Document Deletion Safety Test Suite ===\n');

  // Authenticate as evaluator
  const client = getSupabaseClient();
  const { data: auth, error: authErr } = await client.auth.signInWithPassword({
    email: 'evaluator.demo@gapfinder.ai',
    password: 'EvaluatorPassword2026!'
  });

  if (authErr) {
    console.error('Auth error:', authErr.message);
    process.exit(1);
  }

  const user = {
    id: auth.user.id,
    accessToken: auth.session.access_token
  };
  const userClient = getUserSupabaseClient(user.accessToken);

  let passed = 0;
  let total = 0;
  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // SCENARIO 1: Draft Subject without Edits -> Cleans up automatically
  // -------------------------------------------------------------------------
  console.log('--- Scenario 1: Deleting Document with Unedited Draft Topic Map ---');
  const doc1Id = crypto.randomUUID();
  const sub1Id = crypto.randomUUID();

  // Create disposable document
  await DocumentModel.createDocument(userClient, {
    id: doc1Id,
    userId: user.id,
    fileName: 'disposable_draft.txt',
    storagePath: `test/${doc1Id}.txt`,
    fileType: 'txt',
    fileSize: 100,
    processingStatus: 'completed'
  });

  // Create associated draft subject
  await TopicModel.createSubject(userClient, {
    id: sub1Id,
    userId: user.id,
    sourceDocumentId: doc1Id,
    name: 'Disposable Draft Subject',
    status: 'draft'
  });

  // Delete document
  const del1 = await DocumentService.deleteDocument(user, doc1Id);
  assert(del1 === true, 'Document deleted successfully');

  // Verify subject was also cleaned up (no orphaned subject)
  const orphanedSub = await TopicModel.findSubjectById(userClient, sub1Id);
  assert(orphanedSub === null, 'Associated draft subject cleaned up automatically without leaving orphans');

  // -------------------------------------------------------------------------
  // SCENARIO 2: Document with Approved Subject -> Rejected without confirmation
  // -------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Document with Approved Subject Protection ---');
  const doc2Id = crypto.randomUUID();
  const sub2Id = crypto.randomUUID();

  await DocumentModel.createDocument(userClient, {
    id: doc2Id,
    userId: user.id,
    fileName: 'disposable_approved.txt',
    storagePath: `test/${doc2Id}.txt`,
    fileType: 'txt',
    fileSize: 100,
    processingStatus: 'completed'
  });

  await TopicModel.createSubject(userClient, {
    id: sub2Id,
    userId: user.id,
    sourceDocumentId: doc2Id,
    name: 'Approved Curriculum',
    status: 'approved'
  });

  let threwExpected1 = false;
  try {
    await DocumentService.deleteDocument(user, doc2Id);
  } catch (err) {
    threwExpected1 = true;
    assert(err.code === 'CONFIRMATION_REQUIRED', 'Aborted deletion with CONFIRMATION_REQUIRED error code');
    assert(err.details?.isProtectedStatus === true, 'Error details indicate isProtectedStatus = true');
    assert(err.status === 409, 'Error status code set to 409 Conflict');
  }
  assert(threwExpected1, 'Attempt to delete approved document without confirmation strictly rejected');

  // Verify document and subject are still in database
  const stillDoc2 = await DocumentModel.findById(userClient, doc2Id);
  const stillSub2 = await TopicModel.findSubjectById(userClient, sub2Id);
  assert(stillDoc2 !== null && stillSub2 !== null, 'Approved document and subject remain completely intact in Supabase');

  // Now delete with explicit confirmation
  const del2Confirmed = await DocumentService.deleteDocument(user, doc2Id, { confirmDiscard: true });
  assert(del2Confirmed === true, 'Document deleted cleanly when user provides confirmDiscard: true');
  const goneDoc2 = await DocumentModel.findById(userClient, doc2Id);
  const goneSub2 = await TopicModel.findSubjectById(userClient, sub2Id);
  assert(goneDoc2 === null && goneSub2 === null, 'Document and subject cleaned up upon confirmed deletion');

  // -------------------------------------------------------------------------
  // SCENARIO 3: Document with Student-Edited Topics -> Rejected without confirmation
  // -------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Document with Student Customizations Protection ---');
  const doc3Id = crypto.randomUUID();
  const sub3Id = crypto.randomUUID();
  const topic3Id = crypto.randomUUID();

  await DocumentModel.createDocument(userClient, {
    id: doc3Id,
    userId: user.id,
    fileName: 'disposable_edited.txt',
    storagePath: `test/${doc3Id}.txt`,
    fileType: 'txt',
    fileSize: 100,
    processingStatus: 'completed'
  });

  await TopicModel.createSubject(userClient, {
    id: sub3Id,
    userId: user.id,
    sourceDocumentId: doc3Id,
    name: 'Customized Curriculum',
    status: 'draft'
  });

  // Insert a student-edited topic
  await TopicModel.insertTopics(userClient, [{
    id: topic3Id,
    subject_id: sub3Id,
    user_id: user.id,
    parent_topic_id: null,
    name: 'Student Renamed Topic',
    hierarchy_level: 'chapter',
    display_order: 0,
    source_references: [],
    extraction_metadata: {
      studentEdited: true,
      originalName: 'Old Chapter Name'
    }
  }]);

  let threwExpected2 = false;
  try {
    await DocumentService.deleteDocument(user, doc3Id);
  } catch (err) {
    threwExpected2 = true;
    assert(err.code === 'CONFIRMATION_REQUIRED', 'Aborted deletion with CONFIRMATION_REQUIRED for student edit');
    assert(err.details?.studentEditedCount === 1, 'Error details indicate 1 student customization detected');
  }
  assert(threwExpected2, 'Attempt to delete document with student customizations strictly rejected without confirmation');

  // Verify topic is still intact
  const stillTopic = await TopicModel.findTopicById(userClient, topic3Id);
  assert(stillTopic !== null, 'Student-edited topic remains untouched in Supabase');

  // Now delete with explicit confirmation
  const del3Confirmed = await DocumentService.deleteDocument(user, doc3Id, { confirmDiscard: true });
  assert(del3Confirmed === true, 'Student-edited document deleted upon explicit confirmDiscard: true');
  const goneTopic = await TopicModel.findTopicById(userClient, topic3Id);
  assert(goneTopic === null, 'All associated customized topics cleaned up upon confirmed deletion');

  console.log(`\n=== RESULTS: ${passed} / ${total} TESTS PASSED ===`);
  if (passed === total) {
    console.log('🎉 ALL DOCUMENT DELETION SAFETY CHECKS VERIFIED SUCCESSFULLY!');
  } else {
    process.exit(1);
  }
}

testDeletionSafety().catch(err => {
  console.error('Deletion test failure:', err);
  process.exit(1);
});

