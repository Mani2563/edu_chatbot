import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';

async function testLiveApiExtraction() {
  const client = getSupabaseClient();
  const { data: auth, error: authErr } = await client.auth.signInWithPassword({
    email: 'evaluator.demo@gapfinder.ai',
    password: 'EvaluatorPassword2026!'
  });
  if (authErr) {
    console.error('Auth error:', authErr.message);
    return;
  }

  const mathsDocId = '5a06491f-d395-42ea-9405-51e7a2075141';
  console.log('Testing extraction with user:', auth.user.email);

  // Give ownership of test doc to evaluator so we can test the live API call without touching Manikanta's records
  const admin = getSupabaseAdmin();
  const { data: doc } = await admin.from('documents').select('*').eq('id', mathsDocId).single();
  console.log('Doc original owner:', doc.user_id);

  // Let's call TopicService directly under evaluator user context using the existing chunks
  const { TopicService } = await import('../services/topic-service.js');
  const user = {
    id: auth.user.id,
    accessToken: auth.session.access_token
  };

  // We test on evaluator's ML syllabus document first to verify clean API execution
  const res = await fetch('http://localhost:3000/api/topics/extract', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.session.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sourceDocumentId: 'f19c951f-ac1e-4975-a256-192a9e0f5ee9',
      forceReextract: true
    })
  });

  const data = await res.json();
  console.log('Extract API status:', res.status);
  console.log('Extract API message:', data.message);
  console.log('Subject name:', data.subject?.name);
  console.log('Total nodes:', data.stats?.totalNodes);
}

testLiveApiExtraction().catch(console.error);

