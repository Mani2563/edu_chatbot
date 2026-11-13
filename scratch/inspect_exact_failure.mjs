import { getSupabaseAdmin } from '../lib/supabase.js';
import { getGroqModel } from '../lib/groq.js';
import { generateText } from 'ai';

async function inspectRawResponse() {
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

  console.log('Sending request to Groq model to inspect raw response...');
  const result = await generateText({
    model: groqModel,
    prompt,
    temperature: 0.1
  });

  const rawText = result.text;
  console.log('--- RAW RESPONSE METADATA ---');
  console.log('Raw text length:', rawText.length);
  console.log('Finish reason:', result.finishReason);
  console.log('Has markdown fences:', rawText.includes('```'));

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('No JSON match found at all in response!');
    return;
  }

  const jsonStr = jsonMatch[0];
  console.log('Matched JSON substring length:', jsonStr.length);

  try {
    JSON.parse(jsonStr);
    console.log('JSON.parse succeeded cleanly on this run.');
  } catch (parseErr) {
    console.log('JSON.parse failed as expected!');
    console.log('Error message:', parseErr.message);

    // Find position mentioned in error if any
    const posMatch = parseErr.message.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      console.log(`\n--- CONTEXT AROUND POSITION ${pos} ---`);
      const start = Math.max(0, pos - 150);
      const end = Math.min(jsonStr.length, pos + 150);
      console.log(jsonStr.slice(start, end));
      console.log('^ Pointer roughly at center of slice');
    }
  }
}

inspectRawResponse().catch(err => console.error('Inspection script error:', err));

