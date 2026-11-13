import { getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { DocumentModel } from '../models/document-model.js';
import { TopicModel } from '../models/topic-model.js';
import crypto from 'crypto';

async function testLiveApiDeleteSafety() {
  console.log('=== GapFinder AI: Live API Deletion Safety Verification ===\n');

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

  const docId = crypto.randomUUID();
  const subId = crypto.randomUUID();

  // Create disposable document
  await DocumentModel.createDocument(userClient, {
    id: docId,
    userId: user.id,
    fileName: 'live_test_approved_doc.txt',
    storagePath: `test/${docId}.txt`,
    fileType: 'txt',
    fileSize: 100,
    processingStatus: 'completed'
  });

  // Create associated approved subject
  await TopicModel.createSubject(userClient, {
    id: subId,
    userId: user.id,
    sourceDocumentId: docId,
    name: 'Live Approved Subject',
    status: 'approved'
  });

  console.log('1. Created approved test document & subject');

  // Attempt 1: Call live DELETE API without confirmDiscard
  console.log('2. Sending DELETE without confirmDiscard...');
  const res1 = await fetch(`http://localhost:3000/api/documents/delete?id=${docId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${user.accessToken}`
    }
  });

  const body1 = await res1.json();
  console.log('Response Status:', res1.status);
  console.log('Response Body:', JSON.stringify(body1, null, 2));

  if (res1.status === 409 && body1.code === 'CONFIRMATION_REQUIRED') {
    console.log('✅ PASS: Live API rejected unconfirmed deletion of approved topic map with 409 CONFIRMATION_REQUIRED');
  } else {
    console.error('❌ FAIL: Live API did not reject with 409');
    process.exit(1);
  }

  // Verify doc and subject are still in DB
  const stillDoc = await DocumentModel.findById(userClient, docId);
  const stillSub = await TopicModel.findSubjectById(userClient, subId);
  if (stillDoc && stillSub) {
    console.log('✅ PASS: Document and subject remain intact in Supabase database');
  } else {
    console.error('❌ FAIL: Document or subject was prematurely deleted');
    process.exit(1);
  }

  // Attempt 2: Call live DELETE API with confirmDiscard=true
  console.log('\n3. Sending DELETE with confirmDiscard=true...');
  const res2 = await fetch(`http://localhost:3000/api/documents/delete?id=${docId}&confirmDiscard=true`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${user.accessToken}`
    }
  });

  const body2 = await res2.json();
  console.log('Response Status:', res2.status);
  console.log('Response Body:', JSON.stringify(body2, null, 2));

  if (res2.status === 200 && body2.success === true) {
    console.log('✅ PASS: Live API deleted document upon explicit confirmation');
  } else {
    console.error('❌ FAIL: Live API failed to delete on confirmation');
    process.exit(1);
  }

  // Verify doc and subject are deleted
  const goneDoc = await DocumentModel.findById(userClient, docId);
  const goneSub = await TopicModel.findSubjectById(userClient, subId);
  if (!goneDoc && !goneSub) {
    console.log('✅ PASS: Document and subject cleanly deleted from Supabase database');
  } else {
    console.error('❌ FAIL: Document or subject remains after confirmed deletion');
    process.exit(1);
  }

  console.log('\n🎉 ALL LIVE API DELETION SAFETY CHECKS PASSED!');
}

testLiveApiDeleteSafety().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

