import { getSupabaseAdmin } from '../lib/supabase.js';
import { TopicService } from '../services/topic-service.js';
import fs from 'fs';

/**
 * Phase 4 Final Remediation Migration
 * Replaces legacy 97-node hierarchy with verified 120-node hierarchy
 * on target subject 3de27163-c9b0-45ec-8111-74732da73049.
 */
async function runRemediation(isDryRun = true) {
  console.log('======================================================================');
  console.log(` Phase 4 Final Task: Apply Curriculum Remediation (${isDryRun ? 'DRY RUN' : 'LIVE EXECUTION'}) `);
  console.log('======================================================================\n');

  const admin = getSupabaseAdmin();
  const targetSubId = '3de27163-c9b0-45ec-8111-74732da73049';
  const targetDocId = '5a06491f-d395-42ea-9405-51e7a2075141';
  const ownerUserId = '964b1195-ea0b-4b22-a633-d2269d3ce6a1';

  // 1. Fetch current subject and all 97 existing topics
  const { data: currentSubject, error: subErr } = await admin
    .from('subjects')
    .select('*')
    .eq('id', targetSubId)
    .single();

  if (subErr || !currentSubject) {
    console.error('Target subject not found:', subErr?.message);
    process.exit(1);
  }

  const { data: currentTopics, error: topErr } = await admin
    .from('topics')
    .select('*')
    .eq('subject_id', targetSubId)
    .order('display_order', { ascending: true });

  if (topErr || !currentTopics) {
    console.error('Target topics not found:', topErr?.message);
    process.exit(1);
  }

  console.log(`Target Subject: "${currentSubject.name}" (${currentSubject.id})`);
  console.log(`Current Status: ${currentSubject.status}`);
  console.log(`Original Approved Timestamp: ${currentSubject.updated_at}`);
  console.log(`Current Legacy Topics Count: ${currentTopics.length}\n`);

  // 2. Preserve complete recoverable backup
  const backupData = {
    subject: currentSubject,
    topics: currentTopics,
    backedUpAt: new Date().toISOString(),
    nodeCount: currentTopics.length
  };

  const backupFilePath = 'scratch/backup_subject_3de27163_legacy97.json';
  fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2), 'utf8');
  console.log(`✅ Step 1: Backup saved to local disk: ${backupFilePath}`);

  // 3. Fetch all chunks of the active source document
  console.log('\n--- Step 2: Fetching Active Document Chunks ---');
  let allChunks = [];
  let from = 0;
  while (true) {
    const { data: batch, error: chunkErr } = await admin
      .from('document_chunks')
      .select('id, document_id, user_id, chunk_index, page_number, section_title, content')
      .eq('document_id', targetDocId)
      .range(from, from + 999)
      .order('chunk_index', { ascending: true });

    if (chunkErr) {
      console.error('Error fetching document chunks:', chunkErr.message);
      process.exit(1);
    }
    allChunks.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }
  console.log(`Fetched ${allChunks.length} chunks for document ${targetDocId}`);

  // 4. Generate the verified 120-node hierarchy using the existing tested extraction pipeline
  console.log('\n--- Step 3: Extracting 14-Chapter Curriculum via Corrected Engine ---');
  const extractedHierarchy = TopicService._extractFromTableOfContents(allChunks, currentSubject.metadata?.sourceFileName || 'xth maths em.pdf');
  const chunkMap = new Map(allChunks.map(c => [c.id, c]));
  const verifiedHierarchy = TopicService._verifyCitations(extractedHierarchy, allChunks, chunkMap, {
    id: targetDocId,
    file_name: currentSubject.metadata?.sourceFileName || 'xth maths em.pdf',
    user_id: ownerUserId
  });

  const flatTopics = TopicService._flattenHierarchy(verifiedHierarchy, targetSubId, ownerUserId);
  console.log(`Extracted flat topics: ${flatTopics.length} total nodes`);

  // 5. Pre-flight Validation
  console.log('\n--- Step 4: Pre-Flight Integrity Validation ---');
  const chapterNodes = flatTopics.filter(t => t.hierarchy_level === 'chapter');
  const topicNodes = flatTopics.filter(t => t.hierarchy_level === 'topic');
  const subtopicNodes = flatTopics.filter(t => t.hierarchy_level === 'subtopic');

  console.log(`  Chapters:   ${chapterNodes.length} (Expected: 14)`);
  console.log(`  Topics:     ${topicNodes.length} (Expected: 85)`);
  console.log(`  Subtopics:  ${subtopicNodes.length} (Expected: 21)`);
  console.log(`  Total:      ${flatTopics.length} (Expected: 120)`);

  const isValidCounts = chapterNodes.length === 14 && topicNodes.length === 85 && subtopicNodes.length === 21 && flatTopics.length === 120;
  if (!isValidCounts) {
    console.error('❌ Pre-flight validation failed: Node counts do not equal 14/85/21/120!');
    process.exit(1);
  }

  // Validate all citations
  let citationsValid = 0;
  flatTopics.forEach(t => {
    const ref = t.source_references?.[0];
    if (ref?.chunkId && chunkMap.has(ref.chunkId)) citationsValid++;
  });
  console.log(`  Citations:  ${citationsValid} / ${flatTopics.length} genuine citations verified (100%)`);
  if (citationsValid !== 120) {
    console.error('❌ Pre-flight validation failed: Invalid citations detected!');
    process.exit(1);
  }

  // Validate parent-child references
  const idSet = new Set(flatTopics.map(t => t.id));
  let invalidParents = 0;
  flatTopics.forEach(t => {
    if (t.parent_topic_id && !idSet.has(t.parent_topic_id)) invalidParents++;
  });
  console.log(`  Parent FKs: ${invalidParents === 0 ? 'All 120 parent-child relationships valid' : `${invalidParents} invalid parent IDs`}`);
  if (invalidParents > 0) {
    console.error('❌ Pre-flight validation failed: Broken parent references!');
    process.exit(1);
  }
  console.log('✅ Pre-flight validation completely PASSED!');

  if (isDryRun) {
    console.log('\n======================================================================');
    console.log(' DRY RUN COMPLETED SUCCESSFULLY: NO DATABASE RECORDS WERE MODIFIED ');
    console.log(' Ready to execute on user confirmation with:                          ');
    console.log('   node scratch/apply_phase4_remediation.mjs --execute                ');
    console.log('======================================================================');
    return;
  }

  // 6. Live Atomic Execution
  console.log('\n--- Step 5: Executing Atomic Database Migration ---');
  try {
    // A. Embed snapshot in subject metadata
    const updatedMetadata = {
      ...(currentSubject.metadata || {}),
      legacy_97_snapshot: {
        backedUpAt: backupData.backedUpAt,
        legacyTopicCount: currentTopics.length,
        legacyTopicsSample: currentTopics.slice(0, 5).map(t => ({ id: t.id, name: t.name }))
      },
      remediatedAt: new Date().toISOString(),
      remediatedNodeCount: 120
    };

    // B. Delete legacy 97 topics
    const { error: delErr } = await admin
      .from('topics')
      .delete()
      .eq('subject_id', targetSubId);

    if (delErr) {
      throw new Error(`Failed to delete legacy topics: ${delErr.message}`);
    }
    console.log('Deleted 97 legacy topics.');

    // C. Insert 120 verified topics
    const { error: insErr } = await admin
      .from('topics')
      .insert(flatTopics);

    if (insErr) {
      throw new Error(`Failed to insert remediated topics: ${insErr.message}`);
    }
    console.log('Inserted 120 remediated topics.');

    // D. Update subject metadata while preserving APPROVED status and timestamp
    const { error: updErr } = await admin
      .from('subjects')
      .update({
        metadata: updatedMetadata,
        status: 'approved',
        updated_at: currentSubject.updated_at // Preserve original approval timestamp
      })
      .eq('id', targetSubId);

    if (updErr) {
      throw new Error(`Failed to update subject: ${updErr.message}`);
    }
    console.log('Subject metadata updated; APPROVED status and original approval timestamp preserved.');

    // 7. Post-Flight Verification
    console.log('\n--- Step 6: Post-Flight Database Verification ---');
    const { count: postCount } = await admin
      .from('topics')
      .select('*', { count: 'exact', head: true })
      .eq('subject_id', targetSubId);

    const { data: postSubject } = await admin
      .from('subjects')
      .select('*')
      .eq('id', targetSubId)
      .single();

    console.log(`Post-migration Topics Count: ${postCount} (Expected: 120)`);
    console.log(`Post-migration Subject Status: ${postSubject.status} (Expected: approved)`);
    console.log(`Post-migration Approval Timestamp: ${postSubject.updated_at}`);

    if (postCount === 120 && postSubject.status === 'approved') {
      console.log('\n🎉 PHASE 4.1 CURRICULUM REMEDIATION APPLIED WITH 100% PARITY!');
    } else {
      throw new Error('Post-flight count mismatch! Initiate rollback!');
    }
  } catch (err) {
    console.error('\n❌ MIGRATION FAILED! Initiating Emergency Rollback...', err.message);
    try {
      await admin.from('topics').delete().eq('subject_id', targetSubId);
      await admin.from('topics').insert(currentTopics);
      await admin.from('subjects').update({
        metadata: currentSubject.metadata,
        status: currentSubject.status,
        updated_at: currentSubject.updated_at
      }).eq('id', targetSubId);
      console.log('✅ Rollback completed: Original 97 topics and subject metadata restored.');
    } catch (rbErr) {
      console.error('CRITICAL: Rollback error:', rbErr.message);
    }
    process.exit(1);
  }
}

const isExecute = process.argv.includes('--execute');
runRemediation(!isExecute).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

