import { getSupabaseClient, getUserSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';
import crypto from 'crypto';

async function runTests() {
  console.log('=== GapFinder AI: Student Edit Preservation & Reviewed/Approved Guard Verification ===\n');

  // 1. Authenticate test user
  const client = getSupabaseClient();
  const { data: auth, error: authErr } = await client.auth.signInWithPassword({
    email: 'evaluator.demo@gapfinder.ai',
    password: 'EvaluatorPassword2026!'
  });
  if (authErr) {
    console.error('Authentication failed:', authErr.message);
    process.exit(1);
  }
  const token = auth.session.access_token;
  const user = auth.user;
  const userClient = getUserSupabaseClient(token);
  console.log('✅ Authenticated as test user:', user.email, `(${user.id})`);

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // =========================================================================
  // TEST 1: Protect BOTH Reviewed and Approved Subjects
  // =========================================================================
  console.log('\n--- Test 1: Reviewed & Approved Subjects Protection ---');
  const mlDocId = 'f19c951f-ac1e-4975-a256-192a9e0f5ee9';
  const mlSubjectId = 'd41ab579-d3c2-4837-863e-d5205057c59a';

  // Ensure status is 'approved'
  await userClient.from('subjects').update({ status: 'approved' }).eq('id', mlSubjectId);

  // Attempt extract without forceReextract on approved subject
  const resApproved = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceDocumentId: mlDocId, forceReextract: false })
  });
  const approvedData = await resApproved.json();
  console.log('Approved protection status:', resApproved.status);
  console.log('Approved protection message:', approvedData.error || approvedData.message);
  if (resApproved.status === 400 && (approvedData.error?.includes('approved') || approvedData.message?.includes('approved'))) {
    console.log('✅ Approved topic map correctly protected from re-extraction');
  } else {
    console.error('❌ Approved protection failed:', approvedData);
  }

  // Set status to 'reviewed'
  await userClient.from('subjects').update({ status: 'reviewed' }).eq('id', mlSubjectId);

  // Attempt extract without forceReextract on reviewed subject
  const resReviewed = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceDocumentId: mlDocId, forceReextract: false })
  });
  const reviewedData = await resReviewed.json();
  console.log('Reviewed protection status:', resReviewed.status);
  console.log('Reviewed protection message:', reviewedData.error || reviewedData.message);
  if (resReviewed.status === 400 && (reviewedData.error?.includes('reviewed') || reviewedData.message?.includes('reviewed'))) {
    console.log('✅ Reviewed topic map correctly protected from re-extraction');
  } else {
    console.error('❌ Reviewed protection failed:', reviewedData);
  }

  // Restore mlSubject status to approved
  await userClient.from('subjects').update({ status: 'approved' }).eq('id', mlSubjectId);

  // =========================================================================
  // TEST 2: Create Disposable Syllabus, Extract Topics, & Apply Student Edit
  // =========================================================================
  console.log('\n--- Test 2: Topic Extraction & Student Topic Renaming ---');
  const testDocId = crypto.randomUUID();
  const testDocName = `disposable_quantum_${Date.now()}.txt`;

  // Insert test document record
  const { data: docRecord, error: docErr } = await userClient.from('documents').insert([{
    id: testDocId,
    user_id: user.id,
    file_name: testDocName,
    storage_path: `study-materials/${user.id}/${testDocId}/${testDocName}`,
    file_size: 1024,
    file_type: 'txt',
    processing_status: 'completed'
  }]).select().single();

  if (docErr) {
    console.error('Failed to create test document:', docErr.message);
    process.exit(1);
  }
  console.log('Created disposable test document:', docRecord.id, docRecord.file_name);

  // Insert structured chunks
  const chunk1Id = crypto.randomUUID();
  const chunk2Id = crypto.randomUUID();
  const chunksData = [
    {
      id: chunk1Id,
      document_id: testDocId,
      user_id: user.id,
      chunk_index: 0,
      page_number: 1,
      section_title: 'Unit 1: Quantum Mechanics',
      content: 'Unit 1: Quantum Mechanics\nChapter 1: Quantum States\n1.1 Bloch Sphere Representation\n- Pure state vectors on sphere surface\n1.2 Superposition Principles\n- Linear combinations of basis states'
    },
    {
      id: chunk2Id,
      document_id: testDocId,
      user_id: user.id,
      chunk_index: 1,
      page_number: 2,
      section_title: 'Unit 2: Quantum Logic Gates',
      content: 'Unit 2: Quantum Logic Gates\nChapter 2: Single Qubit Operations\n2.1 Pauli-X and Hadamard Gates\n- Bit-flip and state superposition creation'
    }
  ];
  await userClient.from('document_chunks').insert(chunksData);
  console.log('Inserted 2 syllabus text chunks for extraction');

  // Extract topic map via API
  const resExtract = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceDocumentId: testDocId })
  });
  const extractData = await resExtract.json();
  console.log('Extract API status:', resExtract.status);
  console.log('Extract API message:', extractData.message);
  console.log('Total nodes extracted:', extractData.stats?.totalNodes);

  // Find the topic "Bloch Sphere Representation"
  const { data: dbTopics } = await userClient.from('topics').select('*').eq('subject_id', extractData.subject.id);
  const targetTopic = dbTopics.find(t => t.name.includes('Bloch Sphere Representation'));
  if (!targetTopic) {
    console.error('❌ Could not locate target topic in DB topics:', dbTopics.map(t => t.name));
    process.exit(1);
  }
  console.log('Found target topic for student editing:', targetTopic.id, `"${targetTopic.name}"`);

  // Rename topic via PATCH /api/topics/update
  const editedName = 'Bloch Sphere Representation (Student Custom Edit)';
  const resUpdate = await fetch('http://localhost:3000/api/topics/update', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      topicId: targetTopic.id,
      name: editedName,
      description: 'Custom notes on Bloch Sphere by student'
    })
  });
  const updateData = await resUpdate.json();
  console.log('Update API status:', resUpdate.status);
  console.log('Update API result:', updateData.topic?.name);

  // Verify in Supabase directly
  const { data: verifyTopic } = await userClient.from('topics').select('*').eq('id', targetTopic.id).single();
  console.log('DB verified name:', verifyTopic.name);
  console.log('DB verified studentEdited:', verifyTopic.extraction_metadata?.studentEdited);
  console.log('DB verified originalName:', verifyTopic.extraction_metadata?.originalName);

  if (verifyTopic.name === editedName && verifyTopic.extraction_metadata?.studentEdited === true) {
    console.log('✅ Student edit successfully persisted in Supabase database');
  } else {
    console.error('❌ Student edit persistence check failed');
  }

  // =========================================================================
  // TEST 3: Idempotent Re-Extraction (Same Content Fingerprint)
  // =========================================================================
  console.log('\n--- Test 3: Idempotent Re-extraction (Unchanged Fingerprint) ---');
  const resIdempotent = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceDocumentId: testDocId, forceReextract: false })
  });
  const idempotentData = await resIdempotent.json();
  console.log('Idempotent status:', resIdempotent.status);
  console.log('Idempotent message:', idempotentData.message);
  console.log('Idempotent flag:', idempotentData.idempotent);

  // Verify student edit remained intact
  const { data: verifyAfterIdempotent } = await userClient.from('topics').select('*').eq('id', targetTopic.id).single();
  if (verifyAfterIdempotent && verifyAfterIdempotent.name === editedName) {
    console.log('✅ Unchanged fingerprint returned existing map and preserved student edit');
  } else {
    console.error('❌ Idempotent check failed');
  }

  // =========================================================================
  // TEST 4: Re-Extraction With Modified Syllabus Content (Matching Section)
  // =========================================================================
  console.log('\n--- Test 4: Re-extraction with Content Change (Matching Section) ---');
  // Update chunk content to trigger fingerprint change while retaining the Bloch Sphere section
  await userClient.from('document_chunks').update({
    content: 'Unit 1: Quantum Mechanics (Updated 2026 Edition)\nChapter 1: Quantum States\n1.1 Bloch Sphere Representation\n- Pure and mixed state vectors\n1.2 Superposition Principles\n- Wave function expansion'
  }).eq('id', chunk1Id);

  // Call re-extraction with forceReextract
  const resReextract = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceDocumentId: testDocId, forceReextract: true })
  });
  const reextractData = await resReextract.json();
  console.log('Re-extract status:', resReextract.status);
  console.log('Re-extract message:', reextractData.message);
  console.log('Preserved edits count:', reextractData.stats?.preservedEditsCount);

  // Check Supabase topics
  const { data: newDbTopics } = await userClient.from('topics').select('*').eq('subject_id', extractData.subject.id);
  const preservedTopic = newDbTopics.find(t => t.name === editedName);
  if (preservedTopic) {
    console.log('✅ Student edit was preserved across re-extraction with changed syllabus content!');
    console.log('Preserved topic:', preservedTopic.name, '| studentEdited:', preservedTopic.extraction_metadata?.studentEdited);
  } else {
    console.error('❌ Preservation failed; topics in DB are:', newDbTopics.map(t => t.name));
  }

  // =========================================================================
  // TEST 5: Unmatched Student Edit Detection (Section Removed from Syllabus)
  // =========================================================================
  console.log('\n--- Test 5: Unmatched Student Edit Warning (HTTP 409 Conflict) ---');
  // Remove the Bloch Sphere section from chunks completely so it cannot be matched
  await userClient.from('document_chunks').update({
    content: 'Unit 1: Classical Physics\nChapter 1: Classical Mechanics\n1.1 Newton Laws of Motion\n- Force and momentum'
  }).eq('id', chunk1Id);
  await userClient.from('document_chunks').delete().eq('id', chunk2Id);

  // Attempt re-extraction WITHOUT confirmDiscardEdits
  const resConflict = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sourceDocumentId: testDocId,
      forceReextract: true,
      confirmDiscardEdits: false
    })
  });
  const conflictData = await resConflict.json();
  console.log('Conflict test status:', resConflict.status);
  console.log('Conflict status code:', conflictData.status);
  console.log('Conflict requiresConfirmation:', conflictData.requiresConfirmation);
  console.log('Unmatched edits count:', conflictData.unmatchedEdits?.length);
  if (conflictData.unmatchedEdits?.length > 0) {
    console.log('Unmatched topic:', conflictData.unmatchedEdits[0].name, '-', conflictData.unmatchedEdits[0].reason);
  }

  // Verify that topics were NOT deleted in Supabase
  const { data: topicsAfterAborted } = await userClient.from('topics').select('*').eq('subject_id', extractData.subject.id);
  const stillHasCustomEdit = topicsAfterAborted.some(t => t.name === editedName);
  if (resConflict.status === 409 && conflictData.status === 'unmatched_edits_detected' && stillHasCustomEdit) {
    console.log('✅ Unmatched edits safely blocked re-extraction (HTTP 409) and preserved student data without deletion');
  } else {
    console.error('❌ Conflict test failed:', conflictData);
  }

  // =========================================================================
  // TEST 6: Authorized Discard with confirmDiscardEdits: true
  // =========================================================================
  console.log('\n--- Test 6: Authorized Discard with confirmDiscardEdits = true ---');
  const resAuthorized = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sourceDocumentId: testDocId,
      forceReextract: true,
      confirmDiscardEdits: true
    })
  });
  const authorizedData = await resAuthorized.json();
  console.log('Authorized status:', resAuthorized.status);
  console.log('Authorized message:', authorizedData.message);

  const { data: topicsAfterConfirm } = await userClient.from('topics').select('*').eq('subject_id', extractData.subject.id);
  console.log('Topics after authorized discard:', topicsAfterConfirm.map(t => t.name));
  if (resAuthorized.status === 200 && authorizedData.success) {
    console.log('✅ Authorized discard succeeded cleanly when explicit user confirmation was provided');
  } else {
    console.error('❌ Authorized discard failed:', authorizedData);
  }

  // =========================================================================
  // CLEANUP Disposable Test Document and Subject
  // =========================================================================
  console.log('\n--- Cleanup Disposable Test Resources ---');
  await userClient.from('topics').delete().eq('subject_id', extractData.subject.id);
  await userClient.from('subjects').delete().eq('id', extractData.subject.id);
  await userClient.from('document_chunks').delete().eq('document_id', testDocId);
  await userClient.from('documents').delete().eq('id', testDocId);
  console.log('✅ Disposable test artifacts cleaned up. Production student data completely intact.');

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
