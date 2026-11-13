import { TopicService } from '../services/topic-service.js';

async function runCitationTests() {
  console.log('=== GapFinder AI: Comprehensive Citation Verification Test Suite ===\n');

  const testUserId = 'bf786cdb-9abc-42ed-bf5c-1213cbe5f1ce';
  const otherUserId = '11111111-2222-3333-4444-555555555555';
  const testDocId = 'doc-123-primary';
  const otherDocId = 'doc-999-other';

  const doc = {
    id: testDocId,
    user_id: testUserId,
    file_name: 'test_syllabus.pdf'
  };

  // Mock document chunks
  const validChunk1 = {
    id: 'chunk-real-numbers-001',
    document_id: testDocId,
    user_id: testUserId,
    chunk_index: 0,
    page_number: 1,
    section_title: 'Chapter 1: Real Numbers',
    content: 'Chapter 1 Real Numbers covers the fundamental theorem of arithmetic and irrational numbers.'
  };

  const validChunk2 = {
    id: 'chunk-sets-002',
    document_id: testDocId,
    user_id: testUserId,
    chunk_index: 1,
    page_number: 29,
    section_title: 'Chapter 2: Sets',
    content: 'Sets and subsets: A set is a well-defined collection of objects. Venn diagrams represent relations.'
  };

  const crossDocChunk = {
    id: 'chunk-cross-doc-003',
    document_id: otherDocId, // Cross document!
    user_id: testUserId,
    chunk_index: 0,
    page_number: 5,
    section_title: 'Different Book Chapter',
    content: 'Real Numbers from an entirely different textbook.'
  };

  const crossUserChunk = {
    id: 'chunk-cross-user-004',
    document_id: testDocId,
    user_id: otherUserId, // Cross user!
    chunk_index: 2,
    page_number: 10,
    section_title: 'Real Numbers by Other Student',
    content: 'Real numbers notes belonging to another user.'
  };

  const chunks = [validChunk1, validChunk2, crossDocChunk, crossUserChunk];
  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Test 1: Valid chunk reference supporting topic
  // -------------------------------------------------------------------------
  console.log('--- Test 1: Valid Chunk Reference (Passing All 4 Checks) ---');
  const validPayload = {
    subjectName: 'Math',
    chapters: [
      {
        name: 'Real Numbers',
        sourceChunkId: validChunk1.id,
        topics: [
          {
            name: 'Fundamental Theorem of Arithmetic',
            sourceChunkId: validChunk1.id,
            subtopics: []
          }
        ]
      }
    ]
  };

  const res1 = TopicService._verifyCitations(validPayload, chunks, chunkMap, doc);
  const ch1 = res1.chapters[0];
  const ref1 = ch1.source_references[0];
  assert(ref1?.verified === true, 'Valid chunk reference marked verified: true');
  assert(ch1.extraction_metadata?.confidence === 'high', 'Valid chunk reference assigned confidence: high');
  assert(ref1?.chunkId === validChunk1.id, 'Cites exact matching chunk ID');
  assert(ref1?.documentId === testDocId, 'Cites matching document ID');

  // -------------------------------------------------------------------------
  // Test 2: Nonexistent / Fake Chunk ID
  // -------------------------------------------------------------------------
  console.log('\n--- Test 2: Nonexistent / Fake Chunk ID ---');
  const fakePayload = {
    chapters: [
      {
        name: 'Real Numbers',
        sourceChunkId: 'fake-hallucinated-chunk-id-12345',
        topics: []
      }
    ]
  };

  const res2 = TopicService._verifyCitations(fakePayload, chunks, chunkMap, doc);
  const ch2 = res2.chapters[0];
  const ref2 = ch2.source_references[0];
  assert(ref2?.verified === false, 'Fake chunk reference marked verified: false');
  assert(ch2.extraction_metadata?.confidence === 'unverified', 'Fake chunk reference assigned confidence: unverified (NOT high)');
  assert(ch2.extraction_metadata?.confidence !== 'high', 'NEVER assigns high confidence to fake chunk ID');
  assert(ref2?.verificationError.includes('does not exist'), 'Includes descriptive verificationError');

  // -------------------------------------------------------------------------
  // Test 3: Cross-Document Chunk Reference
  // -------------------------------------------------------------------------
  console.log('\n--- Test 3: Cross-Document Chunk Reference ---');
  const crossDocPayload = {
    chapters: [
      {
        name: 'Real Numbers',
        sourceChunkId: crossDocChunk.id,
        topics: []
      }
    ]
  };

  const res3 = TopicService._verifyCitations(crossDocPayload, chunks, chunkMap, doc);
  const ch3 = res3.chapters[0];
  const ref3 = ch3.source_references[0];
  assert(ref3?.verified === false, 'Cross-document chunk reference marked verified: false');
  assert(ch3.extraction_metadata?.confidence === 'unverified', 'Cross-document chunk assigned confidence: unverified');
  assert(ref3?.verificationError.includes('Cross-document'), 'Includes cross-document error description');

  // -------------------------------------------------------------------------
  // Test 4: Cross-User Chunk Reference
  // -------------------------------------------------------------------------
  console.log('\n--- Test 4: Cross-User Chunk Reference ---');
  const crossUserPayload = {
    chapters: [
      {
        name: 'Real Numbers',
        sourceChunkId: crossUserChunk.id,
        topics: []
      }
    ]
  };

  const res4 = TopicService._verifyCitations(crossUserPayload, chunks, chunkMap, doc);
  const ch4 = res4.chapters[0];
  const ref4 = ch4.source_references[0];
  assert(ref4?.verified === false, 'Cross-user chunk reference marked verified: false');
  assert(ch4.extraction_metadata?.confidence === 'unverified', 'Cross-user chunk assigned confidence: unverified');
  assert(ref4?.verificationError.includes('Cross-user'), 'Includes cross-user error description');

  // -------------------------------------------------------------------------
  // Test 5: Missing Chunk ID
  // -------------------------------------------------------------------------
  console.log('\n--- Test 5: Missing Chunk ID ---');
  const missingPayload = {
    chapters: [
      {
        name: 'Real Numbers',
        sourceChunkId: '', // Empty / missing
        topics: []
      }
    ]
  };

  const res5 = TopicService._verifyCitations(missingPayload, chunks, chunkMap, doc);
  const ch5 = res5.chapters[0];
  assert(ch5.source_references.length === 0, 'Missing chunk ID produces empty source_references');
  assert(ch5.extraction_metadata?.confidence === 'unverified', 'Missing chunk ID assigned confidence: unverified');

  // -------------------------------------------------------------------------
  // Test 6: Valid Chunk ID but Text Does NOT Support Topic
  // -------------------------------------------------------------------------
  console.log('\n--- Test 6: Valid Chunk ID but Content Does NOT Support Topic ---');
  const unsupportedPayload = {
    chapters: [
      {
        name: 'Quantum Teleportation & Photosynthesis', // Zero relevance to Sets
        sourceChunkId: validChunk2.id, // validChunk2 is about Sets
        topics: []
      }
    ]
  };

  const res6 = TopicService._verifyCitations(unsupportedPayload, chunks, chunkMap, doc);
  const ch6 = res6.chapters[0];
  const ref6 = ch6.source_references[0];
  assert(ref6?.verified === false, 'Content mismatch rejected: verified: false');
  assert(ch6.extraction_metadata?.confidence === 'unverified', 'Content mismatch assigned confidence: unverified (NOT high)');
  assert(ref6?.verificationError.includes('does not support'), 'Includes unsupported content verificationError');

  // -------------------------------------------------------------------------
  // Test 7: AI Model returning verified: true in payload MUST NOT bypass verification
  // -------------------------------------------------------------------------
  console.log('\n--- Test 7: AI Model Payload Claiming verified: true ---');
  const aiSpoofPayload = {
    chapters: [
      {
        name: 'Quantum Physics',
        sourceChunkId: 'fake-id',
        verified: true, // Spoofed AI property
        extraction_metadata: { confidence: 'high' },
        topics: []
      }
    ]
  };

  const res7 = TopicService._verifyCitations(aiSpoofPayload, chunks, chunkMap, doc);
  const ch7 = res7.chapters[0];
  assert(ch7.source_references[0]?.verified === false, 'AI spoofed verified: true is strictly rejected (verified: false)');
  assert(ch7.extraction_metadata?.confidence === 'unverified', 'AI spoofed confidence: high is strictly overridden (confidence: unverified)');

  console.log(`\n=== RESULTS: ${passedTests} / ${totalTests} TESTS PASSED ===`);
  if (passedTests === totalTests) {
    console.log('🎉 ALL CITATION VERIFICATION REQUIREMENTS FULLY MET!');
  } else {
    process.exit(1);
  }
}

runCitationTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

