import { getSupabaseAdmin } from '../lib/supabase.js';

async function inspectSubjects() {
  const admin = getSupabaseAdmin();

  console.log('=== APPROVED SUBJECT INSPECTION (3de27163-c9b0-45ec-8111-74732da73049) ===');
  const appSubId = '3de27163-c9b0-45ec-8111-74732da73049';
  const { data: appSub } = await admin.from('subjects').select('*').eq('id', appSubId).single();
  const { data: appTopics } = await admin.from('topics').select('*').eq('subject_id', appSubId).order('display_order', { ascending: true });

  console.log('Subject ID:', appSub.id);
  console.log('Name:', appSub.name);
  console.log('Status:', appSub.status);
  console.log('User ID:', appSub.user_id);
  console.log('Source Document ID:', appSub.source_document_id);
  console.log('Created At:', appSub.created_at);
  console.log('Updated At:', appSub.updated_at);
  console.log('Metadata:', JSON.stringify(appSub.metadata, null, 2));
  console.log('Total Topics in Approved Subject:', appTopics.length);

  const appLevels = {};
  appTopics.forEach(t => appLevels[t.hierarchy_level] = (appLevels[t.hierarchy_level] || 0) + 1);
  console.log('Levels breakdown:', appLevels);

  const nullParents = appTopics.filter(t => !t.parent_topic_id);
  console.log('Root nodes (parent_topic_id is null):', nullParents.length);

  console.log('\nSample topic names in approved subject:');
  appTopics.slice(0, 15).forEach(t => {
    console.log(`  • [${t.hierarchy_level}] "${t.name}" (parent: ${t.parent_topic_id || 'NULL'}, order: ${t.display_order})`);
  });

  console.log('\n=== ORPHANED DRAFT SUBJECT INSPECTION (0a1fdfb5-b609-4148-bcce-51715625e356) ===');
  const draftSubId = '0a1fdfb5-b609-4148-bcce-51715625e356';
  const { data: draftSub } = await admin.from('subjects').select('*').eq('id', draftSubId).single();
  const { data: draftTopics } = await admin.from('topics').select('*').eq('subject_id', draftSubId).order('display_order', { ascending: true });

  console.log('Subject ID:', draftSub.id);
  console.log('Name:', draftSub.name);
  console.log('Status:', draftSub.status);
  console.log('User ID:', draftSub.user_id);
  console.log('Source Document ID:', draftSub.source_document_id);
  console.log('Created At:', draftSub.created_at);
  console.log('Updated At:', draftSub.updated_at);
  console.log('Total Topics in Draft Subject:', draftTopics.length);

  const draftLevels = {};
  draftTopics.forEach(t => draftLevels[t.hierarchy_level] = (draftLevels[t.hierarchy_level] || 0) + 1);
  console.log('Levels breakdown:', draftLevels);

  // Check citations in draft subject against document_chunks
  const draftChunkIds = draftTopics.map(t => t.source_references?.[0]?.chunkId).filter(Boolean);
  const { data: foundChunks } = await admin.from('document_chunks').select('id, document_id').in('id', draftChunkIds);
  console.log(`Citations in draft subject: ${draftChunkIds.length} total cited chunk IDs`);
  console.log(`Matching chunks found in document_chunks: ${foundChunks?.length || 0}`);

  // Check if any active approved subject references any of these chunks
  const { data: activeTopics } = await admin.from('topics').select('id, name, subject_id, source_references').in('subject_id', [appSubId, 'd41ab579-d3c2-4837-863e-d5205057c59a']);
  const draftChunkIdSet = new Set(draftChunkIds);
  const overlapping = activeTopics.filter(t => t.source_references?.some(r => draftChunkIdSet.has(r.chunkId)));
  console.log(`Active approved topics referencing draft subject chunks: ${overlapping.length} (Expected: 0)`);

  // Document existence for draft subject
  const { data: draftDoc } = await admin.from('documents').select('*').eq('id', draftSub.source_document_id || '00000000-0000-0000-0000-000000000000');
  console.log(`Document for draft subject exists in documents table: ${draftDoc?.length > 0}`);
}

inspectSubjects().catch(console.error);

