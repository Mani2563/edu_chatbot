import { getSupabaseAdmin } from '../lib/supabase.js';

async function testFullDeterministicTOC() {
  const admin = getSupabaseAdmin();
  const docId = '5a06491f-d395-42ea-9405-51e7a2075141';

  const { data: chunks } = await admin.from('document_chunks')
    .select('id, chunk_index, page_number, section_title, content')
    .eq('document_id', docId)
    .order('chunk_index', { ascending: true });

  // 1. Locate TOC
  const tocChunk = chunks.find(c =>
    c.page_number <= 20 &&
    (c.content.includes('CHAPTER') || c.content.includes('CONTENTS')) &&
    (c.content.includes('Real  Numbers') || c.content.includes('Real Numbers') || c.content.includes('Sets'))
  );

  const lines = (tocChunk?.content || '').split('\n').map(l => l.trim()).filter(Boolean);
  const chapters = [];
  let currentChap = null;

  for (const line of lines) {
    if (/^(CHAPTER|NUMBER|CONTENTS|SCERT|TELANGANA)/i.test(line)) continue;
    const match = line.match(/^0?(\d{1,2})\s*([A-Za-z][A-Za-z\s,\-–]+)/);
    if (match) {
      const chapNum = parseInt(match[1], 10);
      let rawTitle = match[2]
        .replace(/\d+.*$/, '')
        .replace(/(June|July|August|September|October|November|December|January|February|March|April|May).*$/i, '')
        .trim();
      currentChap = { number: chapNum, name: rawTitle, sourceChunkId: tocChunk.id, topics: [] };
      chapters.push(currentChap);
    } else if (currentChap && /^[A-Za-z\s]+$/.test(line) && !line.includes('SCERT')) {
      currentChap.name = (currentChap.name + ' ' + line.trim()).replace(/\s+/g, ' ');
    }
  }

  // 2. Attach subsections from chunks
  const sectionPattern = /^(\d{1,2}\.\d+(\.\d+)?)\s+([A-Za-z][A-Za-z\s,\-–()]+)$/;
  const seenSections = new Set();

  for (const chunk of chunks) {
    const chunkLines = (chunk.content || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of chunkLines) {
      // Disqualify math/noise
      if (/[=+×÷<>√]/.test(line)) continue;
      if (/\b(cm|mm|m|km|kg|g|s|kmph)\b/i.test(line)) continue;

      const match = line.match(sectionPattern);
      if (match) {
        const secNum = match[1];
        const secTitle = match[3].trim();
        if (secTitle.length < 3 || /^(DO THIS|TRY THIS|EXERCISE|ACTIVITY)/i.test(secTitle)) continue;

        const chapPrefix = parseInt(secNum.split('.')[0], 10);
        const targetChapter = chapters.find(ch => ch.number === chapPrefix);

        if (targetChapter && !seenSections.has(secNum)) {
          seenSections.add(secNum);
          targetChapter.topics.push({
            name: `${secNum} ${secTitle}`,
            sourceChunkId: chunk.id,
            subtopics: []
          });
        }
      }
    }
  }

  console.log('Deterministic TOC fallback result:');
  console.log('Total chapters:', chapters.length);
  for (const ch of chapters) {
    console.log(`\nChapter ${ch.number}: ${ch.name} (topics: ${ch.topics.length})`);
    ch.topics.forEach(t => console.log(`  • ${t.name}`));
  }
}

testFullDeterministicTOC().catch(console.error);

