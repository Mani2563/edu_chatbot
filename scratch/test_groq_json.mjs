import { getSupabaseAdmin } from '../lib/supabase.js';
import { getGroqModel } from '../lib/groq.js';
import { generateText } from 'ai';

async function test() {
  const admin = getSupabaseAdmin();
  const { data: chunks } = await admin.from('document_chunks')
    .select('id, chunk_index, page_number, section_title, content')
    .eq('document_id', '5a06491f-d395-42ea-9405-51e7a2075141')
    .order('chunk_index', { ascending: true })
    .limit(25);

  const groqModel = getGroqModel();
  const chunkContext = chunks.map((c, idx) =>
    `[CHUNK_${idx} ID="${c.id}" PAGE="${c.page_number || 'N/A'}" SECTION="${c.section_title || 'N/A'}"]\n${c.content}`
  ).join('\n\n---\n\n');

  const prompt = `You are an expert curriculum and syllabus extraction engine.
Analyze the following official syllabus document chunks for "xth maths em.pdf".
Extract the authentic topic hierarchy present in the material.

Rules:
1. ONLY extract topics explicitly mentioned in the source chunks. Do NOT invent missing units or topics.
2. If units are present, group by unit. If only chapters exist, use chapters. If flat topics exist, use topics.
3. For every unit, chapter, topic, or subtopic, identify the exact [CHUNK_X ID="..."] from which it originated.
4. Output valid JSON strictly conforming to this structure:
{
  "subjectName": "string",
  "subjectDescription": "string",
  "units": [
    {
      "name": "Unit name",
      "description": "optional",
      "sourceChunkId": "uuid-or-CHUNK_X",
      "chapters": [
        {
          "name": "Chapter name",
          "description": "optional",
          "sourceChunkId": "uuid-or-CHUNK_X",
          "topics": [
            {
              "name": "Topic name",
              "sourceChunkId": "uuid-or-CHUNK_X",
              "subtopics": [{ "name": "Subtopic name", "sourceChunkId": "uuid-or-CHUNK_X" }]
            }
          ]
        }
      ]
    }
  ],
  "chapters": [],
  "topics": []
}

Source syllabus chunks:
${chunkContext}`;

  console.log('Sending prompt to Groq model...');
  const res = await generateText({
    model: groqModel,
    prompt,
    temperature: 0.1
  });

  console.log('Finish reason:', res.finishReason);
  console.log('Text length:', res.text.length);
  console.log('Tail of text:\n', res.text.slice(-300));

  try {
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON match found');
    const parsed = JSON.parse(jsonMatch[0]);
    console.log('JSON Parse SUCCESS! Subject:', parsed.subjectName);
    console.log('Units count:', parsed.units?.length, 'Chapters:', parsed.chapters?.length, 'Topics:', parsed.topics?.length);
  } catch (err) {
    console.error('JSON Parse Error:', err.message);
  }
}

test().catch(console.error);

