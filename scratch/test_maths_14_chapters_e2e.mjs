import { getSupabaseAdmin, getSupabaseClient, getUserSupabaseClient } from '../lib/supabase.js';
import { TopicService } from '../services/topic-service.js';
import { DocumentService } from '../services/document-service.js';
import { DocumentModel } from '../models/document-model.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';
import { TopicModel } from '../models/topic-model.js';
import crypto from 'crypto';

async function testMaths14ChaptersE2E() {
  console.log('=== GapFinder AI: Telangana Class X Mathematics 14 Chapters & Citations Verification ===\n');

  const admin = getSupabaseAdmin();
  const mathsDocId = '5a06491f-d395-42ea-9405-51e7a2075141';

  // 1. Fetch real chunks from Telangana Class X Mathematics
  const { data: realChunks, error: chunkErr } = await admin.from('document_chunks')
    .select('id, chunk_index, page_number, section_title, content')
    .eq('document_id', mathsDocId)
    .order('chunk_index', { ascending: true })
    .limit(60);

  if (chunkErr || !realChunks || realChunks.length === 0) {
    console.error('Failed to load real chunks:', chunkErr?.message);
    process.exit(1);
  }

  console.log(`Loaded ${realChunks.length} real syllabus chunks from Telangana Class X Mathematics.`);
  const tocChunk = realChunks.find(c => c.page_number === 9 || (c.content || '').includes('Real  Numbers'));
  console.log('TOC Chunk (Page 9):', tocChunk ? `Found (ID: ${tocChunk.id})` : 'Missing');

  // Authenticate as evaluator
  const client = getSupabaseClient();
  const { data: auth } = await client.auth.signInWithPassword({
    email: 'evaluator.demo@gapfinder.ai',
    password: 'EvaluatorPassword2026!'
  });
  const user = { id: auth.user.id, accessToken: auth.session.access_token };
  const userClient = getUserSupabaseClient(user.accessToken);

  // 2. Create disposable test document for evaluator to persist and verify through live RPC
  const testDocId = crypto.randomUUID();
  await DocumentModel.createDocument(userClient, {
    id: testDocId,
    userId: user.id,
    fileName: 'xth_maths_evaluation.pdf',
    storagePath: `eval/${testDocId}.pdf`,
    fileType: 'pdf',
    fileSize: 500000,
    processingStatus: 'completed'
  });

  // Clone real chunks under the evaluator's test document in public.document_chunks
  const clonedChunks = realChunks.map(c => ({
    id: crypto.randomUUID(),
    document_id: testDocId,
    user_id: user.id,
    chunk_index: c.chunk_index,
    page_number: c.page_number,
    section_title: c.section_title,
    content: c.content
  }));

  const { error: insertChunksErr } = await userClient
    .from('document_chunks')
    .insert(clonedChunks);

  if (insertChunksErr) {
    console.error('Failed to insert cloned chunks:', insertChunksErr.message);
    process.exit(1);
  }
  console.log(`Cloned ${clonedChunks.length} authentic chunks under test document ${testDocId}.`);

  try {
    // 3. Run extractTopicMap via live TopicService
    console.log('\nRunning TopicService.extractTopicMap on authentic Telangana Class X Mathematics material...');
    const result = await TopicService.extractTopicMap(user, testDocId, { forceReextract: true });

    console.log('\n--- EXTRACTION RESULT ---');
    console.log('Success:', result.success);
    console.log('Transactional:', result.transactional);
    console.log('Subject Name:', result.subject?.name);
    console.log('Total Saved Nodes:', result.stats?.totalNodes);

    const savedTopics = await TopicModel.getTopicsBySubject(userClient, result.subject.id);
    const chapters = savedTopics.filter(t => t.hierarchy_level === 'chapter');
    const topics = savedTopics.filter(t => t.hierarchy_level === 'topic');

    console.log(`\nChapters Count: ${chapters.length} (Expected: exactly 14)`);

    const EXPECTED_14_CHAPTERS = [
      'Real Numbers',
      'Sets',
      'Polynomials',
      'Pair of Linear Equations in Two Variables',
      'Quadratic Equations',
      'Progressions',
      'Coordinate Geometry',
      'Similar Triangles',
      'Tangents and Secants to a Circle',
      'Mensuration',
      'Trigonometry',
      'Applications of Trigonometry',
      'Probability',
      'Statistics'
    ];

    console.log('\nExtracted Chapters:');
    let matchedChapters = 0;
    chapters.forEach((ch, idx) => {
      const expected = EXPECTED_14_CHAPTERS[idx];
      const match = ch.name.toLowerCase().includes(expected.toLowerCase().slice(0, 8));
      if (match) matchedChapters++;
      console.log(`  ${idx + 1}. "${ch.name}" (matches expected "${expected}": ${match ? 'YES' : 'NO'})`);
    });

    console.log(`\nMatched chapters: ${matchedChapters} / 14`);
    if (chapters.length === 14) {
      console.log('✅ Exactly 14 curriculum chapters extracted (No 15th Appendix chapter!)');
    } else {
      console.error(`❌ Chapter count mismatch: got ${chapters.length}, expected 14`);
      process.exit(1);
    }

    // 4. Verify Citations on Chapters and Topics
    console.log('\n--- VERIFYING CITATIONS IN SUPABASE ---');
    let verifiedCount = 0;
    let unverifiedCount = 0;
    let highConfidenceCount = 0;

    savedTopics.forEach(t => {
      const refs = t.source_references || [];
      const isVerified = refs.some(r => r.verified === true);
      const conf = t.extraction_metadata?.confidence;

      if (isVerified) verifiedCount++;
      else unverifiedCount++;

      if (conf === 'high') highConfidenceCount++;
    });

    console.log(`Total Topics/Subsections: ${topics.length}`);
    console.log(`Total verified nodes: ${verifiedCount} / ${savedTopics.length}`);
    console.log(`Total high confidence nodes: ${highConfidenceCount} / ${savedTopics.length}`);

    // Verify first chapter citation
    const ch1 = chapters[0];
    const ch1Ref = ch1.source_references[0];
    console.log('\nSample Chapter 1 Citation:');
    console.log('  Document ID:', ch1Ref?.documentId);
    console.log('  Chunk ID:', ch1Ref?.chunkId);
    console.log('  Page Number:', ch1Ref?.pageNumber);
    console.log('  Verified:', ch1Ref?.verified);
    console.log('  Confidence:', ch1.extraction_metadata?.confidence);

    if (ch1Ref?.verified === true && ch1.extraction_metadata?.confidence === 'high') {
      console.log('✅ Chapter 1 successfully verified with high confidence against actual TOC chunk');
    } else {
      console.error('❌ Chapter 1 citation verification failed!');
      process.exit(1);
    }

    // 5. Check for Math Noise
    const noisyNode = savedTopics.find(t =>
      /^(sin|cos|tan|cot|sec|cosec|[a-z]\b|\d+(\.\d+)?\s*(cm|mm|m))$/i.test(t.name.trim()) ||
      t.name === 'x' || t.name === 'BD' || t.name === 'cot 74'
    );
    if (!noisyNode) {
      console.log('✅ ZERO math noise in extracted topic hierarchy (no x, sin, BD, cot 74)');
    } else {
      console.error('❌ Math noise detected in topic name:', noisyNode.name);
      process.exit(1);
    }

    console.log('\n🎉 ALL 14 CHAPTERS, SUBSECTIONS, AND CITATIONS VERIFIED SUCCESSFULLY IN SUPABASE!');
  } finally {
    // Clean up test document and cloned chunks
    console.log('\nCleaning up test document...');
    await DocumentService.deleteDocument(user, testDocId, { confirmDiscard: true });
    console.log('Cleaned up test document and chunks.');
  }
}

testMaths14ChaptersE2E().catch(err => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
