import { getSupabaseAdmin } from '../lib/supabase.js';
import { getGroqModel } from '../lib/groq.js';
import { generateText, Output } from 'ai';
import { z } from 'zod';

const SubtopicSchema = z.object({
  name: z.string().describe('Title of the subtopic'),
  sourceChunkId: z.string().describe('Source chunk ID from which this subtopic was identified')
});

const TopicSchema = z.object({
  name: z.string().describe('Title of the topic/section'),
  subtopics: z.array(SubtopicSchema).describe('Subtopics under this topic'),
  sourceChunkId: z.string().describe('Source chunk ID from which this topic was identified')
});

const ChapterSchema = z.object({
  name: z.string().describe('Official chapter title (e.g. "Real Numbers", "Sets")'),
  topics: z.array(TopicSchema).describe('Main topics/sections in this chapter'),
  sourceChunkId: z.string().describe('Source chunk ID for this chapter')
});

const CurriculumSchema = z.object({
  subjectName: z.string().describe('Curriculum subject name (e.g. "Mathematics Class X")'),
  subjectDescription: z.string().describe('Concise description of the curriculum'),
  chapters: z.array(ChapterSchema).describe('All chapters listed in the curriculum')
});

async function testTocExtraction() {
  const admin = getSupabaseAdmin();
  const docId = '5a06491f-d395-42ea-9405-51e7a2075141';

  // 1. Fetch chunks
  const { data: allChunks } = await admin.from('document_chunks')
    .select('id, chunk_index, page_number, section_title, content')
    .eq('document_id', docId)
    .order('chunk_index', { ascending: true });

  console.log('Total chunks loaded:', allChunks.length);

  // 2. Locate Table of Contents
  const tocChunk = allChunks.find(c =>
    c.page_number <= 20 &&
    (c.content.includes('CHAPTER') || c.content.includes('CONTENTS')) &&
    (c.content.includes('Real  Numbers') || c.content.includes('Real Numbers') || c.content.includes('Sets'))
  );

  console.log('TOC Chunk found:', tocChunk ? `Chunk ${tocChunk.chunk_index} on Page ${tocChunk.page_number}` : 'NOT FOUND');

  // 3. Select representative chapter introduction chunks
  const selectedChunks = [];
  if (tocChunk) {
    selectedChunks.push(tocChunk);
  }

  // Find chunks with chapter intro headers like "1.1 INTRODUCTION", "2.1 INTRODUCTION", etc.
  for (let ch = 1; ch <= 14; ch++) {
    const introChunk = allChunks.find(c =>
      c.content.includes(`${ch}.1`) &&
      c.content.toUpperCase().includes('INTRODUCTION')
    );
    if (introChunk && !selectedChunks.some(s => s.id === introChunk.id)) {
      selectedChunks.push(introChunk);
    }
  }

  console.log('Selected representative chunks count:', selectedChunks.length);
  selectedChunks.forEach(c => console.log(`  Chunk ${c.chunk_index} (Page ${c.page_number}): ${c.section_title}`));

  // 4. Build prompt
  const chunkContext = selectedChunks.map((c, idx) =>
    `[CHUNK_${idx} ID="${c.id}" PAGE="${c.page_number}" SECTION="${c.section_title}"]\n${c.content}`
  ).join('\n\n---\n\n');

  const prompt = `You are an expert curriculum structure extractor.
Analyze the following official textbook chunks for "Telangana Class X Mathematics".

CRITICAL INSTRUCTIONS:
1. The Table of Contents (TOC) lists exactly 14 official chapters:
   Chapter 1: Real Numbers
   Chapter 2: Sets
   Chapter 3: Polynomials
   Chapter 4: Pair of Linear Equations in Two Variables
   Chapter 5: Quadratic Equations
   Chapter 6: Progressions
   Chapter 7: Coordinate Geometry
   Chapter 8: Similar Triangles
   Chapter 9: Tangents and Secants to a Circle
   Chapter 10: Mensuration
   Chapter 11: Trigonometry
   Chapter 12: Applications of Trigonometry
   Chapter 13: Probability
   Chapter 14: Statistics

2. Extract ALL 14 chapters in order.
3. For each chapter, extract its authentic syllabus topics/subsections from the provided chunks.
4. Do NOT include exercise questions, math formulas, equations, or random variables (like x, sin, BD, cot 74) as topics.
5. Identify the exact sourceChunkId for each node from the provided [CHUNK_X ID="..."] headers.

Source chunks:
${chunkContext}`;

  const groqModel = getGroqModel('openai/gpt-oss-120b');

  console.log('\nCalling Groq with schema-constrained structured output (Output.object)...');
  const res = await generateText({
    model: groqModel,
    output: Output.object({ schema: CurriculumSchema }),
    prompt,
    temperature: 0.1
  });

  const output = res.output;
  console.log('\n--- STRUCTURED EXTRACTION SUCCESS! ---');
  console.log('Subject:', output.subjectName);
  console.log('Chapters extracted:', output.chapters.length);
  output.chapters.forEach((ch, i) => {
    console.log(`\nChapter ${i + 1}: ${ch.name} (sourceChunkId: ${ch.sourceChunkId})`);
    ch.topics.forEach(t => console.log(`  - Topic: ${t.name}`));
  });
}

testTocExtraction().catch(err => console.error('TOC test error:', err));

