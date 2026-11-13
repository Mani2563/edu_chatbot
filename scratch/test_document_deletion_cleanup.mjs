import { getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import crypto from 'crypto';

async function testDeletionCleanup() {
  console.log('--- Testing Document Deletion Cleanup of Topics & Subjects ---');
  const client = getSupabaseClient();
  const { data: auth } = await client.auth.signInWithPassword({
    email: 'evaluator.demo@gapfinder.ai',
    password: 'EvaluatorPassword2026!'
  });

  const userClient = getUserSupabaseClient(auth.session.access_token);
  const testDocId = crypto.randomUUID();
  const testDocName = `temp_deletion_test_${Date.now()}.txt`;

  // 1. Create temporary test document
  const { data: doc } = await userClient.from('documents').insert([{
    id: testDocId,
    user_id: auth.user.id,
    file_name: testDocName,
    storage_path: `study-materials/${auth.user.id}/${testDocId}/${testDocName}`,
    file_size: 1024,
    file_type: 'txt',
    processing_status: 'completed'
  }]).select().single();

  // 2. Insert dummy chunks
  const chunkId = crypto.randomUUID();
  await userClient.from('document_chunks').insert([{
    id: chunkId,
    document_id: testDocId,
    user_id: auth.user.id,
    chunk_index: 0,
    page_number: 1,
    section_title: 'Unit 1: Test Topic',
    content: 'Unit 1: Test Topic\n1.1 Test Section\nSome syllabus text.'
  }]);

  // 3. Extract topics to create subject and topics records
  const extractRes = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sourceDocumentId: testDocId })
  });
  const extractData = await extractRes.json();
  const subjectId = extractData.subject?.id;
  console.log('Created test subject:', subjectId);

  // Verify subject and topics exist in Supabase
  const { count: topicCountBefore } = await userClient.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId);
  console.log('Topics created before deletion:', topicCountBefore);

  // 4. Delete the document via DELETE /api/documents/delete?id=...
  const delRes = await fetch(`http://localhost:3000/api/documents/delete?id=${testDocId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${auth.session.access_token}`
    }
  });
  const delData = await delRes.json();
  console.log('Delete document response status:', delRes.status, delData.message);

  // 5. Verify that public.documents, public.subjects, and public.topics are completely deleted
  const { data: docAfter } = await userClient.from('documents').select('*').eq('id', testDocId).maybeSingle();
  const { data: subjectAfter } = await userClient.from('subjects').select('*').eq('id', subjectId).maybeSingle();
  const { count: topicCountAfter } = await userClient.from('topics').select('*', { count: 'exact', head: true }).eq('subject_id', subjectId);

  console.log('Document exists after delete:', Boolean(docAfter));
  console.log('Subject exists after delete:', Boolean(subjectAfter));
  console.log('Topics count after delete:', topicCountAfter);

  if (!docAfter && !subjectAfter && topicCountAfter === 0) {
    console.log('✅ PASS: Deleting document cleanly deleted associated subject and topics with ZERO orphans left behind!');
  } else {
    console.error('❌ FAIL: Orphaned records still remain in database!');
  }
}

testDeletionCleanup().catch(console.error);

