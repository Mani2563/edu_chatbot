import { getSupabaseAdmin } from '../lib/supabase.js';
import fs from 'fs';

async function generateExactNodeByNodeLedger() {
  const admin = getSupabaseAdmin();
  const approvedSubId = '3de27163-c9b0-45ec-8111-74732da73049';

  // 1. Fetch all 97 approved topics from Supabase
  const { data: approvedTopics, error } = await admin
    .from('topics')
    .select('id, name, hierarchy_level, parent_topic_id, display_order, source_references, extraction_metadata')
    .eq('subject_id', approvedSubId)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Failed to fetch approved topics:', error);
    process.exit(1);
  }

  // 2. Load the 120 remediated nodes from task-1450.log
  // In task-1450.log, we had the exact 14 chapters, 85 subsections, and 21 subtopics
  // Let's also parse them directly from TopicService._extractFromTableOfContents on the document chunks
  const docId = '5a06491f-d395-42ea-9405-51e7a2075141';
  let allChunks = [];
  let from = 0;
  while (true) {
    const { data: batch } = await admin.from('document_chunks')
      .select('id, document_id, user_id, chunk_index, page_number, section_title, content')
      .eq('document_id', docId)
      .range(from, from + 999)
      .order('chunk_index', { ascending: true });
    allChunks.push(...batch);
    if (batch.length < 1000) break;
    from += 1000;
  }

  const { TopicService } = await import('../services/topic-service.js');
  const remediatedExtracted = TopicService._extractFromTableOfContents(allChunks, 'xth maths em.pdf');
  const chunkMap = new Map(allChunks.map(c => [c.id, c]));
  const verifiedRemediated = TopicService._verifyCitations(remediatedExtracted, allChunks, chunkMap, { id: docId, file_name: 'xth maths em.pdf', user_id: '964b1195-ea0b-4b22-a633-d2269d3ce6a1' });
  const flatRemediated = TopicService._flattenHierarchy(verifiedRemediated, approvedSubId, '964b1195-ea0b-4b22-a633-d2269d3ce6a1');

  console.log(`Approved subject topics fetched: ${approvedTopics.length}`);
  console.log(`Remediated flat topics generated: ${flatRemediated.length}`);

  // 3. Exact Node-by-Node Analysis
  // Normalize helper
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Categorize 97 approved topics
  const approvedMatched = [];
  const approvedNoiseOrSpurious = [];

  for (const app of approvedTopics) {
    const appNorm = norm(app.name);
    // Find in flatRemediated
    const match = flatRemediated.find(rem => {
      const remNorm = norm(rem.name);
      return remNorm === appNorm || (remNorm.length > 5 && appNorm.length > 5 && (remNorm.includes(appNorm) || appNorm.includes(remNorm)));
    });

    if (match) {
      approvedMatched.push({ approved: app, remediated: match });
    } else {
      approvedNoiseOrSpurious.push(app);
    }
  }

  // Find which of flatRemediated are present in approved
  const remediatedPresent = [];
  const remediatedMissingInApproved = [];

  for (const rem of flatRemediated) {
    const remNorm = norm(rem.name);
    const match = approvedTopics.find(app => {
      const appNorm = norm(app.name);
      return remNorm === appNorm || (remNorm.length > 5 && appNorm.length > 5 && (remNorm.includes(appNorm) || appNorm.includes(remNorm)));
    });

    if (match) {
      remediatedPresent.push({ remediated: rem, approved: match });
    } else {
      remediatedMissingInApproved.push(rem);
    }
  }

  console.log(`\n=== EXACT NODE-BY-NODE CLASSIFICATION ===`);
  console.log(`Remediated Total Nodes: ${flatRemediated.length}`);
  console.log(`  - Present in Approved Subject: ${remediatedPresent.length}`);
  console.log(`  - Completely Missing from Approved Subject: ${remediatedMissingInApproved.length}`);
  console.log(`    Sum: ${remediatedPresent.length} + ${remediatedMissingInApproved.length} = ${remediatedPresent.length + remediatedMissingInApproved.length}`);

  console.log(`\nApproved Total Nodes: ${approvedTopics.length}`);
  console.log(`  - Valid Curriculum Nodes (matching remediated): ${approvedMatched.length}`);
  console.log(`  - Spurious / Mathematical Noise / Unmatched Nodes: ${approvedNoiseOrSpurious.length}`);
  console.log(`    Sum: ${approvedMatched.length} + ${approvedNoiseOrSpurious.length} = ${approvedMatched.length + approvedNoiseOrSpurious.length}`);

  // Group missing nodes by chapter
  const missingByChapter = {};
  remediatedMissingInApproved.forEach(rem => {
    // Find chapter name
    let chName = 'Unknown';
    if (rem.hierarchy_level === 'chapter') {
      chName = rem.name;
    } else if (rem.parent_topic_id) {
      const parent = flatRemediated.find(p => p.id === rem.parent_topic_id);
      if (parent?.hierarchy_level === 'chapter') chName = parent.name;
      else {
        const grandParent = flatRemediated.find(g => g.id === parent?.parent_topic_id);
        chName = grandParent?.name || parent?.name || 'Unknown';
      }
    }
    if (!missingByChapter[chName]) missingByChapter[chName] = [];
    missingByChapter[chName].push(rem);
  });

  console.log('\nMissing Remediated Nodes by Chapter in Approved Subject:');
  for (const [ch, nodes] of Object.entries(missingByChapter)) {
    console.log(`  Chapter: "${ch}" (${nodes.length} missing nodes)`);
    nodes.forEach(n => console.log(`    • [${n.hierarchy_level}] ${n.name}`));
  }

  console.log('\nSpurious / Noise Nodes in Approved Subject:');
  approvedNoiseOrSpurious.forEach(n => {
    console.log(`  • [${n.hierarchy_level}] "${n.name}" (order: ${n.display_order})`);
  });
}

generateExactNodeByNodeLedger().catch(console.error);

