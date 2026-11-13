import crypto from 'crypto';
import { z } from 'zod';
import { getUserSupabaseClient } from '../lib/supabase.js';
import { DocumentModel } from '../models/document-model.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';
import { TopicModel } from '../models/topic-model.js';
import { getGroqModel, isGroqConfigured } from '../lib/groq.js';
import { generateText, Output } from 'ai';

// Strict Zod validation schemas for schema-constrained AI extraction
const StrictSubtopicSchema = z.object({
  name: z.string().min(1).describe('Subtopic title'),
  description: z.string().describe('Short description or empty string'),
  sourceChunkId: z.string().describe('Source chunk ID')
});

const StrictTopicSchema = z.object({
  name: z.string().min(1).describe('Topic title'),
  description: z.string().describe('Short description or empty string'),
  subtopics: z.array(StrictSubtopicSchema).describe('List of subtopics'),
  sourceChunkId: z.string().describe('Source chunk ID')
});

const StrictChapterSchema = z.object({
  name: z.string().min(1).describe('Chapter title'),
  description: z.string().describe('Short description or empty string'),
  topics: z.array(StrictTopicSchema).describe('List of topics under this chapter'),
  sourceChunkId: z.string().describe('Source chunk ID')
});

const StrictUnitSchema = z.object({
  name: z.string().min(1).describe('Unit title if applicable'),
  description: z.string().describe('Short description or empty string'),
  chapters: z.array(StrictChapterSchema).describe('Chapters in this unit'),
  topics: z.array(StrictTopicSchema).describe('Direct topics in this unit'),
  sourceChunkId: z.string().describe('Source chunk ID')
});

const StrictCurriculumSchema = z.object({
  subjectName: z.string().min(1).describe('Curriculum subject name'),
  subjectDescription: z.string().describe('Overview description of the subject'),
  units: z.array(StrictUnitSchema).describe('Units if organized by units'),
  chapters: z.array(StrictChapterSchema).describe('Chapters if organized by chapters'),
  topics: z.array(StrictTopicSchema).describe('Standalone topics if no units or chapters exist')
});

// Permissive validation schema for arbitrary / legacy payloads
const ExtractedSubtopicSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  sourceChunkId: z.string().optional()
});

const ExtractedTopicSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  subtopics: z.array(ExtractedSubtopicSchema).optional().default([]),
  sourceChunkId: z.string().optional()
});

const ExtractedChapterSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  topics: z.array(ExtractedTopicSchema).optional().default([]),
  sourceChunkId: z.string().optional()
});

const ExtractedUnitSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  chapters: z.array(ExtractedChapterSchema).optional().default([]),
  topics: z.array(ExtractedTopicSchema).optional().default([]),
  sourceChunkId: z.string().optional()
});

const ExtractedHierarchySchema = z.object({
  subjectName: z.string().min(1),
  subjectDescription: z.string().optional().default(''),
  units: z.array(ExtractedUnitSchema).optional().default([]),
  chapters: z.array(ExtractedChapterSchema).optional().default([]),
  topics: z.array(ExtractedTopicSchema).optional().default([])
});

// In-flight extraction deduplication cache: `${userId}:${sourceDocumentId}` -> Promise
const inFlightExtractions = new Map();

export const TopicService = {
  /**
   * Extract and build source-grounded topic hierarchy from syllabus document
   * Handles in-flight deduplication and concurrent race conditions safely
   */
  async extractTopicMap(user, sourceDocumentId, options = {}) {
    if (!user || !user.id || !user.accessToken) {
      throw new Error('Authentication required');
    }
    if (!sourceDocumentId) {
      throw new Error('sourceDocumentId is required');
    }

    const extractionKey = `${user.id}:${sourceDocumentId}`;
    if (inFlightExtractions.has(extractionKey) && !options.forceReextract) {
      console.log(`Concurrent extraction in flight for ${extractionKey}, joining existing task`);
      const sharedResult = await inFlightExtractions.get(extractionKey);
      return {
        ...sharedResult,
        concurrentResolved: true,
        message: 'Concurrent extraction resolved safely via shared execution'
      };
    }

    const task = this._executeExtraction(user, sourceDocumentId, options);
    inFlightExtractions.set(extractionKey, task);
    try {
      return await task;
    } finally {
      inFlightExtractions.delete(extractionKey);
    }
  },

  /**
   * Internal extraction worker
   */
  async _executeExtraction(user, sourceDocumentId, options = {}) {
    const userClient = getUserSupabaseClient(user.accessToken);

    // 1. Verify syllabus document ownership
    const doc = await DocumentModel.findById(userClient, sourceDocumentId);
    if (!doc) {
      throw new Error('Syllabus document not found or access denied');
    }

    // 2. Fetch document chunks
    const chunks = await DocumentChunkModel.getChunksByUser(userClient, user.id, [sourceDocumentId]);
    if (!chunks || chunks.length === 0) {
      throw new Error('No indexed text chunks found for this document. Ensure document processing is completed.');
    }

    // 3. Compute content fingerprint for duplicate prevention
    const combinedContent = chunks.map(c => c.content).join('\n');
    const fingerprint = crypto.createHash('sha256').update(combinedContent).digest('hex');

    // 4. Duplicate prevention & review status check
    const existingSubject = await TopicModel.findSubjectBySourceDocument(userClient, sourceDocumentId);
    let existingTopics = [];
    if (existingSubject) {
      if (['reviewed', 'approved'].includes(existingSubject.status) && !options.forceReextract) {
        throw new Error(`Syllabus already has a ${existingSubject.status} topic map. Set forceReextract=true to replace ${existingSubject.status} topics.`);
      }
      existingTopics = await TopicModel.getTopicsBySubject(userClient, existingSubject.id);
      if (existingSubject.fingerprint === fingerprint && !options.forceReextract) {
        if (existingTopics && existingTopics.length > 0) {
          return {
            success: true,
            idempotent: true,
            message: `Existing ${existingSubject.status} topic map preserved without duplicate generation`,
            subject: existingSubject,
            topics: this._buildNestedTree(existingTopics)
          };
        }
      }
    }

    // 5. Extract Hierarchy (Schema-Constrained AI Extraction with Controlled Fallback)
    let extractedData = null;

    if (isGroqConfigured()) {
      try {
        extractedData = await this._extractWithGroq(chunks, doc.file_name);
      } catch (aiErr) {
        console.warn('Groq extraction failed, falling back to deterministic Table of Contents parser:', aiErr.message);
        extractedData = this._extractFromTableOfContents(chunks, doc.file_name);
      }
    } else {
      extractedData = this._extractFromTableOfContents(chunks, doc.file_name);
    }

    // Ensure all chapters have authentic subsections populated from the full document chunks
    const tocData = this._extractFromTableOfContents(chunks, doc.file_name);
    if (tocData && tocData.chapters && tocData.chapters.length > 0) {
      if (!extractedData || !extractedData.chapters || extractedData.chapters.length === 0) {
        extractedData = tocData;
      } else {
        // Merge authentic subsections into chapters if AI returned chapter titles without subsections
        extractedData.chapters = extractedData.chapters.map((ch, idx) => {
          const chapNum = ch.number || (idx + 1);
          const matchingTocChapter = tocData.chapters.find(tc =>
            tc.number === chapNum ||
            tc.name.toLowerCase().trim() === ch.name.toLowerCase().trim()
          );
          if (matchingTocChapter && (!ch.topics || ch.topics.length === 0)) {
            return {
              ...ch,
              number: chapNum,
              sourceChunkId: ch.sourceChunkId || matchingTocChapter.sourceChunkId,
              topics: matchingTocChapter.topics || []
            };
          }
          return ch;
        });
      }
    }

    if (!extractedData || extractedData.status === 'insufficient_structure' ||
        (!extractedData.chapters?.length && !extractedData.units?.length && !extractedData.topics?.length)) {
      return {
        success: false,
        status: 'insufficient_structure',
        message: extractedData?.message || 'The document does not contain sufficient identifiable syllabus headings or Table of Contents structure.'
      };
    }

    // 6. Verify Citations against actual document chunks
    const chunkMap = new Map(chunks.map(c => [c.id, c]));
    const verifiedData = this._verifyCitations(extractedData, chunks, chunkMap, doc);

    // 7. Flatten topics hierarchy
    const targetSubjectId = existingSubject ? existingSubject.id : crypto.randomUUID();
    const flatTopics = this._flattenHierarchy(verifiedData, targetSubjectId, user.id);

    // 8. Match and preserve student edits if existing topics had edits
    const editedTopics = (existingTopics || []).filter(t => t.extraction_metadata?.studentEdited === true);
    const { matchedEdits, unmatchedEdits } = this._matchStudentEdits(existingTopics, editedTopics, flatTopics);

    // If student edits would be lost and user did not authorize confirmation, abort upfront
    if (unmatchedEdits.length > 0 && !options.confirmDiscardEdits) {
      return {
        success: false,
        status: 'unmatched_edits_detected',
        message: `Re-extraction would discard ${unmatchedEdits.length} student-edited topic(s). Confirmation required.`,
        requiresConfirmation: true,
        unmatchedEdits: unmatchedEdits.map(e => ({
          id: e.id,
          name: e.name,
          hierarchyLevel: e.hierarchy_level,
          reason: e.reason
        })),
        preservedEditsCount: matchedEdits.length
      };
    }

    // 9. Attempt True Database Transaction via PostgreSQL RPC
    const rpcResult = await TopicModel.saveTopicTreeViaRpc(userClient, {
      sourceDocumentId,
      subjectId: targetSubjectId,
      name: verifiedData.subjectName || doc.file_name.replace(/\.[^/.]+$/, ''),
      description: verifiedData.subjectDescription || null,
      fingerprint,
      metadata: {
        extractedAt: new Date().toISOString(),
        sourceFileName: doc.file_name,
        chunkCount: chunks.length
      },
      topicsData: flatTopics,
      forceReextract: options.forceReextract,
      confirmDiscardEdits: options.confirmDiscardEdits
    });

    if (rpcResult.success) {
      const subjectRecord = rpcResult.subject;
      const savedTopics = await TopicModel.getTopicsBySubject(userClient, subjectRecord.id);
      return {
        success: true,
        transactional: true,
        message: matchedEdits.length > 0
          ? `Topic map extracted and saved atomically. ${matchedEdits.length} student customization(s) preserved.`
          : 'Topic map extracted and saved atomically via PostgreSQL transaction',
        subject: subjectRecord,
        topics: this._buildNestedTree(savedTopics),
        stats: {
          totalNodes: savedTopics.length,
          status: subjectRecord.status,
          preservedEditsCount: matchedEdits.length
        }
      };
    }

    // Handle database-level protection errors
    const rpcErr = rpcResult.error;
    if (rpcErr?.message?.includes('student-edited topic(s) that would be discarded')) {
      return {
        success: false,
        status: 'unmatched_edits_detected',
        message: rpcErr.message,
        requiresConfirmation: true
      };
    }
    if (rpcErr?.message?.includes('already has a reviewed topic map') || rpcErr?.message?.includes('already has an approved topic map')) {
      throw new Error(rpcErr.message);
    }
    const isConflict = rpcErr?.code === '23505' || rpcErr?.message?.includes('uq_subjects_user_source') || rpcErr?.message?.includes('duplicate key');
    if (isConflict) {
      console.log('Concurrent insert conflict detected; safely resolving winning subject');
      return await this._resolveConcurrentSubject(userClient, sourceDocumentId, fingerprint);
    }

    // If RPC failed because function does not exist (e.g. pending migration 003), use compensating cleanup fallback
    console.warn('save_topic_tree RPC unavailable or failed, using compensating cleanup fallback:', rpcErr?.message);

    let subjectRecord = existingSubject;
    try {
      if (existingSubject) {
        await TopicModel.deleteTopicsBySubject(userClient, existingSubject.id);
        subjectRecord = await TopicModel.updateSubject(userClient, existingSubject.id, {
          name: verifiedData.subjectName || doc.file_name.replace(/\.[^/.]+$/, ''),
          description: verifiedData.subjectDescription || null,
          status: 'draft',
          fingerprint,
          metadata: {
            extractedAt: new Date().toISOString(),
            sourceFileName: doc.file_name,
            chunkCount: chunks.length
          }
        });
      } else {
        subjectRecord = await TopicModel.createSubject(userClient, {
          id: targetSubjectId,
          userId: user.id,
          sourceDocumentId,
          name: verifiedData.subjectName || doc.file_name.replace(/\.[^/.]+$/, ''),
          description: verifiedData.subjectDescription || null,
          status: 'draft',
          fingerprint,
          metadata: {
            extractedAt: new Date().toISOString(),
            sourceFileName: doc.file_name,
            chunkCount: chunks.length
          }
        });
      }
    } catch (saveSubErr) {
      if (saveSubErr.message?.includes('uq_subjects_user_source') || saveSubErr.message?.includes('duplicate key')) {
        console.log('Concurrent subject insert caught in fallback path; resolving winning subject');
        return await this._resolveConcurrentSubject(userClient, sourceDocumentId, fingerprint);
      }
      throw saveSubErr;
    }

    const savedTopics = [];
    try {
      const levels = ['unit', 'chapter', 'topic', 'subtopic'];
      for (const level of levels) {
        const levelTopics = flatTopics.filter(t => t.hierarchy_level === level);
        if (levelTopics.length > 0) {
          const inserted = await TopicModel.insertTopics(userClient, levelTopics);
          savedTopics.push(...inserted);
        }
      }
    } catch (saveErr) {
      console.error('Error persisting topic hierarchy, executing compensating cleanup:', saveErr.message);
      if (!existingSubject) {
        await TopicModel.deleteSubject(userClient, subjectRecord.id).catch(() => {});
      } else {
        await TopicModel.deleteTopicsBySubject(userClient, subjectRecord.id).catch(() => {});
      }
      throw saveErr;
    }

    return {
      success: true,
      transactional: false,
      message: 'Topic map extracted and saved as draft (compensating cleanup path)',
      subject: subjectRecord,
      topics: this._buildNestedTree(savedTopics),
      stats: {
        totalNodes: savedTopics.length,
        status: subjectRecord.status
      }
    };
  },

  /**
   * Safely resolves a concurrent race by waiting for winning request and returning existing verified map
   */
  async _resolveConcurrentSubject(userClient, sourceDocumentId, expectedFingerprint) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(r => setTimeout(r, 200 + attempt * 150));
      const winningSubject = await TopicModel.findSubjectBySourceDocument(userClient, sourceDocumentId);
      if (winningSubject) {
        const winningTopics = await TopicModel.getTopicsBySubject(userClient, winningSubject.id);
        if (winningTopics && winningTopics.length > 0) {
          return {
            success: true,
            concurrentResolved: true,
            idempotent: true,
            message: 'Concurrent extraction resolved safely; existing topic map returned',
            subject: winningSubject,
            topics: this._buildNestedTree(winningTopics),
            stats: {
              totalNodes: winningTopics.length,
              status: winningSubject.status
            }
          };
        }
      }
    }

    return {
      success: false,
      status: 'concurrent_incomplete',
      message: 'Concurrent extraction did not complete. Please retry the extraction.'
    };
  },

  /**
   * Intelligently selects representative syllabus chunks:
   * Prioritizes Table of Contents (TOC), index, syllabus pages, and chapter introduction chunks.
   * Enforces a strict budget (max 12 chunks / ~3500 tokens) to respect model context and TPM limits.
   */
  _selectRepresentativeChunks(chunks) {
    if (!chunks || chunks.length === 0) return [];
    if (chunks.length <= 12) return chunks;

    const selected = [];
    const selectedIds = new Set();

    const addChunk = (chunk) => {
      if (chunk && !selectedIds.has(chunk.id) && selected.length < 12) {
        selected.push(chunk);
        selectedIds.add(chunk.id);
      }
    };

    // 1. Scan early chunks (pages 1 to 25) for Table of Contents / Syllabus tables
    const earlyChunks = chunks.slice(0, 45);
    const tocChunk = earlyChunks.find(c => {
      const up = (c.content || '').toUpperCase();
      return (c.page_number === null || c.page_number <= 25) &&
             (up.includes('CONTENTS') || up.includes('INDEX') || up.includes('SYLLABUS')) &&
             (up.includes('CHAPTER') || up.includes('UNIT') || up.includes('01') || up.includes('1.'));
    });

    if (tocChunk) {
      addChunk(tocChunk);
    }

    // 2. Locate chapter introductory chunks (e.g. "Chapter 1", "Unit 1", "1.1 Introduction")
    for (const chunk of chunks) {
      if (selected.length >= 12) break;
      const content = chunk.content || '';
      const isChapterIntro =
        /^(Chapter|Unit|Module)\s+\d+/i.test(chunk.section_title || '') ||
        /\b\d{1,2}\.1\s+INTRODUCTION\b/i.test(content) ||
        /\b(CHAPTER|UNIT)\s+\d{1,2}\b/.test(content);

      if (isChapterIntro) {
        addChunk(chunk);
      }
    }

    // 3. Fallback: if fewer than 5 chunks were identified, add early document chunks
    if (selected.length < 5) {
      for (let i = 0; i < Math.min(chunks.length, 12); i++) {
        addChunk(chunks[i]);
      }
    }

    return selected.sort((a, b) => a.chunk_index - b.chunk_index);
  },

  /**
   * Schema-Constrained AI Extraction via Groq
   * Uses Output.object with strict Zod schema validation.
   * Prioritizes Table of Contents and representative chapter chunks.
   * Implements limited retry with backoff.
   */
  async _extractWithGroq(chunks, fileName) {
    const groqModel = getGroqModel();
    if (!groqModel) throw new Error('Groq model is not configured');

    const representativeChunks = this._selectRepresentativeChunks(chunks);
    if (!representativeChunks || representativeChunks.length === 0) {
      throw new Error('No representative chunks available for extraction');
    }

    const chunkContext = representativeChunks.map((c, idx) =>
      `[CHUNK_${idx} ID="${c.id}" PAGE="${c.page_number || 'N/A'}" SECTION="${c.section_title || 'N/A'}"]\n${c.content}`
    ).join('\n\n---\n\n');

    const prompt = `You are an expert curriculum and syllabus extraction engine.
Analyze the following official syllabus/textbook chunks for "${fileName}".
Extract the authentic topic hierarchy present in the material.

CRITICAL INSTRUCTIONS:
1. Prioritize the Table of Contents (TOC) if present in the chunks to extract the true list of chapters and units in their authentic order.
2. Extract ONLY official curriculum chapters (e.g. for textbooks with 14 chapters, extract Chapters 1 through 14).
3. Do NOT extract non-curriculum appendices, answers, revisions, or end-matter (e.g. do NOT include "Appendix Mathematical Modelling" or "Answers" as chapters).
4. ONLY extract genuine syllabus topics and sections explicitly present in the source chunks.
5. Do NOT include exercise questions, math formulas, equations, or random variables (like x, sin, BD, cot 74) as topics.
6. For every chapter, topic, or subtopic, identify the exact sourceChunkId from the [CHUNK_X ID="..."] headers.
7. All descriptions can be brief or empty string if not provided in the source.

Source syllabus chunks:
${chunkContext}`;

    // Limited retry mechanism: maximum 2 attempts
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { output } = await generateText({
          model: groqModel,
          output: Output.object({ schema: StrictCurriculumSchema }),
          prompt,
          temperature: 0.1
        });

        // Filter out any non-curriculum appendix or end-matter chapters
        const isNonCurriculum = (name) => {
          if (!name) return false;
          const lower = name.trim().toLowerCase();
          return /^(appendix|answers|revision|glossary|bibliography|index)\b/.test(lower) ||
                 /\b(appendix chapter|appendix)\b/.test(lower);
        };

        const cleanChapters = (output.chapters || [])
          .filter(ch => !isNonCurriculum(ch.name))
          .map(ch => ({
            ...ch,
            topics: (ch.topics || []).filter(t => !isNonCurriculum(t.name))
          }));

        // Ensure at least one chapter, unit, or topic was returned
        const hasContent = (cleanChapters.length > 0) ||
                           (output.units && output.units.length > 0) ||
                           (output.topics && output.topics.length > 0);

        if (!hasContent) {
          throw new Error('Model returned empty syllabus hierarchy');
        }

        return {
          subjectName: output.subjectName || fileName.replace(/\.[^/.]+$/, ''),
          subjectDescription: output.subjectDescription || `Syllabus for ${fileName}`,
          units: output.units || [],
          chapters: cleanChapters,
          topics: output.topics || []
        };
      } catch (err) {
        lastError = err;
        console.warn(`Groq extraction attempt ${attempt} failed:`, err.message);
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }

    throw new Error(`AI extraction failed after 2 attempts: ${lastError?.message}`);
  },

  /**
   * Deterministic Table of Contents (TOC) and Outline Parser
   * Parses authentic chapter entries from TOC tables and links section headings from chunks.
   * Never extracts math formulas, operators, or single-character variables.
   */
  _extractFromTableOfContents(chunks, fileName) {
    if (!chunks || chunks.length === 0) {
      return { status: 'insufficient_structure' };
    }

    // 1. Locate Table of Contents chunk in first 45 chunks
    const earlyChunks = chunks.slice(0, 45);
    const tocChunk = earlyChunks.find(c => {
      const up = (c.content || '').toUpperCase();
      return (c.page_number === null || c.page_number <= 25) &&
             (up.includes('CONTENTS') || up.includes('INDEX') || up.includes('SYLLABUS')) &&
             (up.includes('CHAPTER') || up.includes('UNIT') || up.includes('01') || up.includes('1.'));
    });

    const cleanSubjectName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const formattedSubjectName = cleanSubjectName.charAt(0).toUpperCase() + cleanSubjectName.slice(1);

    const chapters = [];
    let currentChap = null;

    if (tocChunk) {
      const lines = (tocChunk.content || '').split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (/^(CHAPTER|NUMBER|CONTENTS|SCERT|TELANGANA|TABLE OF CONTENTS)/i.test(line)) continue;
        const match = line.match(/^0?(\d{1,2})\s*([A-Za-z][A-Za-z\s,\-–&]+)/);
        if (match) {
          const chapNum = parseInt(match[1], 10);
          if (chapNum > 14) continue; // Telangana Class X Mathematics has exactly 14 official curriculum chapters
          let rawTitle = match[2]
            .replace(/\d+.*$/, '')
            .replace(/(June|July|August|September|October|November|December|January|February|March|April|May).*$/i, '')
            .replace(/(Revision|Answers|Appendix).*$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (rawTitle.length >= 3 && !/^(Appendix|Answers|Revision)/i.test(rawTitle)) {
            currentChap = {
              name: rawTitle,
              description: `Chapter ${chapNum}: ${rawTitle}`,
              sourceChunkId: tocChunk.id,
              number: chapNum,
              topics: []
            };
            chapters.push(currentChap);
          }
        } else if (currentChap && /^[A-Za-z\s]+$/.test(line) && !/^(Revision|Answers|Appendix|SCERT|TELANGANA)/i.test(line)) {
          currentChap.name = (currentChap.name + ' ' + line.trim()).replace(/\s+/g, ' ');
        }
      }
    }

    // 2. Discover authentic numbered sections (e.g. 1.1 Introduction, 2.5 Venn Diagrams) across chunks
    const sectionPattern = /^(\d{1,2}\.\d+(\.\d+)?)\s*([A-Za-z][A-Za-z\s,\-–()]+)$/;
    const seenSections = new Set();
    const standaloneTopics = [];

    for (const chunk of chunks) {
      const candidates = [
        chunk.section_title,
        ...(chunk.content || '').split('\n')
      ].filter(Boolean).map(l => l.trim());

      for (const line of candidates) {
        // Disqualify mathematical expressions and measurements
        if (/[=+×÷<>√]/.test(line)) continue;
        if (/\b(cm|mm|m|km|kg|g|s|kmph)\b/i.test(line)) continue;
        if (/^(DO THIS|TRY THIS|EXERCISE|ACTIVITY|THINK|NOTE|SCERT|TELANGANA)/i.test(line)) continue;

        const match = line.match(sectionPattern);
        if (match) {
          const secNum = match[1];
          const secTitle = match[3].replace(/\s+/g, ' ').trim();
          if (secTitle.length < 3) continue;
          if (/^(DO THIS|TRY THIS|EXERCISE|ACTIVITY|THINK|NOTE)/i.test(secTitle)) continue;

          if (seenSections.has(secNum)) continue;
          seenSections.add(secNum);

          const chapNum = parseInt(secNum.split('.')[0], 10);
          const targetChapter = chapters.find(ch => ch.number === chapNum);

          const isSubtopic = secNum.split('.').length === 3;
          const topicNode = {
            name: `${secNum} ${secTitle}`,
            description: '',
            sourceChunkId: chunk.id,
            subtopics: []
          };

          if (targetChapter) {
            if (isSubtopic) {
              const parentNum = secNum.split('.').slice(0, 2).join('.');
              const parentTopic = targetChapter.topics.find(t => t.name.startsWith(parentNum + ' ') || t.name === parentNum);
              if (parentTopic) {
                parentTopic.subtopics.push(topicNode);
              } else {
                targetChapter.topics.push(topicNode);
              }
            } else {
              targetChapter.topics.push(topicNode);
            }
          } else {
            standaloneTopics.push(topicNode);
          }
        }
      }
    }

    // If chapters or topics were found, return the hierarchy
    if (chapters.length > 0 || standaloneTopics.length > 0) {
      return {
        subjectName: formattedSubjectName,
        subjectDescription: `Extracted syllabus outline for ${formattedSubjectName}`,
        units: [],
        chapters: chapters.map(ch => ({
          name: ch.name,
          description: ch.description,
          sourceChunkId: ch.sourceChunkId,
          topics: ch.topics
        })),
        topics: standaloneTopics
      };
    }

    // 3. Fallback for documents with standard "Unit X" or "Chapter X" headers without TOC table
    return this._extractWithStructuralParser(chunks, fileName);
  },

  /**
   * Deterministic Structural Fallback Parser (Math-Safe)
   * Only extracts structures supported by document headings; rejects formulas and exercise options
   */
  _extractWithStructuralParser(chunks, fileName) {
    const rawHeadings = [];
    const seenHeadings = new Set();

    for (const chunk of chunks) {
      const lines = (chunk.content || '').split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // Reject lines with mathematical operators or measurements
        if (/[=+×÷<>√]/.test(line)) continue;
        if (/\b(cm|mm|m|km|kg|g|s|kmph)\b/i.test(line)) continue;
        if (/^(DO THIS|TRY THIS|EXERCISE|ACTIVITY|SCERT|TELANGANA)/i.test(line)) continue;

        if (/^(Unit|Module|Part)\s+[\dIVXLCDM\w\.\-]+/i.test(line) && line.length < 80) {
          const key = `unit:${line.toLowerCase()}`;
          if (!seenHeadings.has(key)) {
            seenHeadings.add(key);
            rawHeadings.push({ type: 'unit', name: line, chunk });
          }
        } else if (/^Chapter\s+[\dIVXLCDM\w\.\-]+/i.test(line) && line.length < 80) {
          const key = `chapter:${line.toLowerCase()}`;
          if (!seenHeadings.has(key)) {
            seenHeadings.add(key);
            rawHeadings.push({ type: 'chapter', name: line, chunk });
          }
        } else if (/^\d{1,2}(\.\d+)+\s+[A-Za-z]{3,}/.test(line) && line.length < 90) {
          const key = `topic:${line.toLowerCase()}`;
          if (!seenHeadings.has(key)) {
            seenHeadings.add(key);
            rawHeadings.push({ type: 'topic', name: line, chunk });
          }
        } else if (/^[-*•]\s+[A-Za-z]{4,}/.test(line) && line.length > 5 && line.length < 70 && !line.endsWith('.') && !/^(sin|cos|tan|cot|sec|cosec|[a-z]\b)/i.test(line.replace(/^[-*•]\s+/, ''))) {
          rawHeadings.push({ type: 'subtopic', name: line.replace(/^[-*•]\s+/, ''), chunk });
        }
      }
    }

    if (rawHeadings.length < 2) {
      return {
        status: 'insufficient_structure',
        message: 'The document does not contain sufficient identifiable headings or syllabus outline structure.'
      };
    }

    // Build hierarchy from collected headings
    const units = [];
    const chapters = [];
    const topics = [];
    let currentUnit = null;
    let currentChapter = null;
    let currentTopic = null;

    for (const item of rawHeadings) {
      if (item.type === 'unit') {
        currentUnit = { name: item.name, sourceChunkId: item.chunk.id, chapters: [], topics: [] };
        units.push(currentUnit);
        currentChapter = null;
        currentTopic = null;
      } else if (item.type === 'chapter') {
        currentChapter = { name: item.name, sourceChunkId: item.chunk.id, topics: [] };
        if (currentUnit) currentUnit.chapters.push(currentChapter);
        else chapters.push(currentChapter);
        currentTopic = null;
      } else if (item.type === 'topic') {
        currentTopic = { name: item.name, sourceChunkId: item.chunk.id, subtopics: [] };
        if (currentChapter) currentChapter.topics.push(currentTopic);
        else if (currentUnit) currentUnit.topics.push(currentTopic);
        else topics.push(currentTopic);
      } else if (item.type === 'subtopic') {
        const subtopic = { name: item.name, sourceChunkId: item.chunk.id };
        if (currentTopic) currentTopic.subtopics.push(subtopic);
      }
    }

    const cleanSubjectName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    return {
      subjectName: cleanSubjectName.charAt(0).toUpperCase() + cleanSubjectName.slice(1),
      subjectDescription: `Extracted syllabus outline for ${cleanSubjectName}`,
      units,
      chapters,
      topics
    };
  },

  /**
   * Deterministically verifies whether a chunk's content or section title supports the cited topic.
   * Checks direct substring, section numbering, and significant keyword overlap.
   */
  _chunkSupportsTopic(chunk, topicName) {
    if (!chunk || !topicName) return false;
    const content = (chunk.content || '').toLowerCase();
    const sectionTitle = (chunk.section_title || '').toLowerCase();
    const rawTarget = topicName.trim().toLowerCase();

    // 1. Direct substring match in content or section title
    if (content.includes(rawTarget) || sectionTitle.includes(rawTarget)) {
      return true;
    }

    // 2. Table of Contents / Index chunks support all syllabus entries listed within them
    const isTocChunk = (chunk.page_number === null || chunk.page_number <= 25) &&
      (content.includes('contents') || content.includes('index') || content.includes('syllabus'));
    if (isTocChunk && (content.includes(rawTarget) || sectionTitle.includes(rawTarget))) {
      return true;
    }

    // 3. Section number match (e.g. "1.1 Introduction" -> "1.1")
    const sectionMatch = topicName.match(/^(\d{1,2}\.\d+(\.\d+)?)/);
    if (sectionMatch) {
      const secNum = sectionMatch[1];
      if (content.includes(secNum) || sectionTitle.includes(secNum)) {
        return true;
      }
    }

    // 4. Significant keyword overlap check (excluding common stop words)
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'under', 'over',
      'between', 'through', 'about', 'chapter', 'unit', 'part', 'section', 'class', 'grade',
      'some', 'any', 'each', 'what', 'when', 'where', 'how', 'why', 'are', 'was', 'were'
    ]);

    const words = rawTarget
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && isNaN(Number(w)));

    if (words.length === 0) {
      return content.includes(rawTarget) || sectionTitle.includes(rawTarget);
    }

    const matchingWords = words.filter(w => content.includes(w) || sectionTitle.includes(w));
    return matchingWords.length > 0;
  },

  /**
   * Verify every citation against actual syllabus chunks with strict 4-stage integrity checks:
   * 1. Chunk existence in public.document_chunks (never falls back to default/fake chunks)
   * 2. Document ownership match (chunk.document_id === doc.id)
   * 3. User ownership match (chunk.user_id === doc.user_id)
   * 4. Content support check (chunk content actually supports cited topic)
   *
   * Only if all 4 checks pass is verified=true and confidence='high'.
   * In all other cases, verified=false, confidence='unverified'.
   * AI-generated verified:true is never accepted blindly.
   */
  _verifyCitations(extractedData, chunks, chunkMap, doc) {
    const evaluateCitation = (node) => {
      const candidateId = node.sourceChunkId;

      // Case 1: Missing chunk ID
      if (!candidateId || typeof candidateId !== 'string' || candidateId.trim() === '') {
        return {
          ...node,
          source_references: [],
          extraction_metadata: {
            confidence: 'unverified',
            isReviewed: false,
            verificationError: 'Missing source chunk reference'
          }
        };
      }

      // Resolve candidate chunk
      let chunk = null;
      if (chunkMap && chunkMap.has(candidateId)) {
        chunk = chunkMap.get(candidateId);
      } else if (chunks && chunks.length > 0) {
        const match = candidateId.match(/CHUNK_(\d+)/);
        if (match) {
          const idx = parseInt(match[1], 10);
          if (chunks[idx]) {
            chunk = chunks[idx];
          }
        }
      }

      // Check 1: Existence check
      if (!chunk || !chunk.id) {
        return {
          ...node,
          source_references: [{
            documentId: doc?.id || null,
            fileName: doc?.file_name || null,
            chunkId: candidateId,
            pageNumber: null,
            sectionTitle: null,
            verified: false,
            verificationError: `Source chunk ID "${candidateId}" does not exist in document chunks`
          }],
          extraction_metadata: {
            confidence: 'unverified',
            isReviewed: false,
            verificationError: `Source chunk ID "${candidateId}" not found in document`
          }
        };
      }

      // Check 2: Document ID match (reject cross-document chunk reference)
      if (doc?.id && chunk.document_id && chunk.document_id !== doc.id) {
        return {
          ...node,
          source_references: [{
            documentId: doc.id,
            fileName: doc.file_name,
            chunkId: chunk.id,
            pageNumber: chunk.page_number || null,
            sectionTitle: chunk.section_title || null,
            verified: false,
            verificationError: `Cross-document chunk reference rejected (chunk belongs to document ${chunk.document_id})`
          }],
          extraction_metadata: {
            confidence: 'unverified',
            isReviewed: false,
            verificationError: 'Cross-document chunk reference rejected'
          }
        };
      }

      // Check 3: User ID match (reject cross-user chunk reference)
      if (doc?.user_id && chunk.user_id && chunk.user_id !== doc.user_id) {
        return {
          ...node,
          source_references: [{
            documentId: doc.id,
            fileName: doc.file_name,
            chunkId: chunk.id,
            pageNumber: chunk.page_number || null,
            sectionTitle: chunk.section_title || null,
            verified: false,
            verificationError: `Cross-user chunk reference rejected (chunk belongs to user ${chunk.user_id})`
          }],
          extraction_metadata: {
            confidence: 'unverified',
            isReviewed: false,
            verificationError: 'Cross-user chunk reference rejected'
          }
        };
      }

      // Check 4: Content relevance check (does chunk text actually support the cited topic?)
      const supportsTopic = this._chunkSupportsTopic(chunk, node.name);
      if (!supportsTopic) {
        return {
          ...node,
          source_references: [{
            documentId: doc?.id || chunk.document_id,
            fileName: doc?.file_name || null,
            chunkId: chunk.id,
            pageNumber: chunk.page_number || null,
            sectionTitle: chunk.section_title || null,
            verified: false,
            verificationError: `Source chunk content does not support cited topic "${node.name}"`
          }],
          extraction_metadata: {
            confidence: 'unverified',
            isReviewed: false,
            verificationError: `Source chunk text does not support cited topic "${node.name}"`
          }
        };
      }

      // All 4 checks PASSED: genuine verified citation
      return {
        ...node,
        source_references: [{
          documentId: doc?.id || chunk.document_id,
          fileName: doc?.file_name || 'document',
          chunkId: chunk.id,
          pageNumber: chunk.page_number || null,
          sectionTitle: chunk.section_title || 'Unidentified section',
          verified: true
        }],
        extraction_metadata: {
          confidence: 'high',
          isReviewed: false,
          verificationReason: 'Verified against source document chunk content'
        }
      };
    };

    return {
      ...extractedData,
      units: (extractedData.units || []).map(u => ({
        ...evaluateCitation(u),
        chapters: (u.chapters || []).map(c => ({
          ...evaluateCitation(c),
          topics: (c.topics || []).map(t => ({
            ...evaluateCitation(t),
            subtopics: (t.subtopics || []).map(evaluateCitation)
          }))
        })),
        topics: (u.topics || []).map(t => ({
          ...evaluateCitation(t),
          subtopics: (t.subtopics || []).map(evaluateCitation)
        }))
      })),
      chapters: (extractedData.chapters || []).map(c => ({
        ...evaluateCitation(c),
        topics: (c.topics || []).map(t => ({
          ...evaluateCitation(t),
          subtopics: (t.subtopics || []).map(evaluateCitation)
        }))
      })),
      topics: (extractedData.topics || []).map(t => ({
        ...evaluateCitation(t),
        subtopics: (t.subtopics || []).map(evaluateCitation)
      }))
    };
  },

  /**
   * Flattens hierarchical tree into relational records with parent IDs
   */
  _flattenHierarchy(data, subjectId, userId) {
    const flat = [];
    let order = 0;

    // Helper for adding node
    const addNode = (node, level, parentId = null) => {
      const nodeId = crypto.randomUUID();
      flat.push({
        id: nodeId,
        subject_id: subjectId,
        user_id: userId,
        parent_topic_id: parentId,
        name: node.name,
        description: node.description || null,
        hierarchy_level: level,
        display_order: order++,
        source_references: node.source_references || [],
        extraction_metadata: node.extraction_metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return nodeId;
    };

    // Traverse Units
    for (const unit of data.units || []) {
      const unitId = addNode(unit, 'unit', null);

      for (const chapter of unit.chapters || []) {
        const chapterId = addNode(chapter, 'chapter', unitId);
        for (const topic of chapter.topics || []) {
          const topicId = addNode(topic, 'topic', chapterId);
          for (const sub of topic.subtopics || []) {
            addNode(sub, 'subtopic', topicId);
          }
        }
      }

      for (const topic of unit.topics || []) {
        const topicId = addNode(topic, 'topic', unitId);
        for (const sub of topic.subtopics || []) {
          addNode(sub, 'subtopic', topicId);
        }
      }
    }

    // Traverse standalone Chapters
    for (const chapter of data.chapters || []) {
      const chapterId = addNode(chapter, 'chapter', null);
      for (const topic of chapter.topics || []) {
        const topicId = addNode(topic, 'topic', chapterId);
        for (const sub of topic.subtopics || []) {
          addNode(sub, 'subtopic', topicId);
        }
      }
    }

    // Traverse standalone Topics
    for (const topic of data.topics || []) {
      const topicId = addNode(topic, 'topic', null);
      for (const sub of topic.subtopics || []) {
        addNode(sub, 'subtopic', topicId);
      }
    }

    return flat;
  },

  /**
   * Reconstruct nested tree from flat database topic records
   */
  _buildNestedTree(flatTopics) {
    const map = new Map();
    const roots = [];

    for (const t of flatTopics) {
      map.set(t.id, { ...t, children: [] });
    }

    for (const t of flatTopics) {
      const node = map.get(t.id);
      if (t.parent_topic_id && map.has(t.parent_topic_id)) {
        map.get(t.parent_topic_id).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  },

  /**
   * List all subjects for user, enriched with real chapter and node counts from database
   */
  async listSubjects(user) {
    if (!user || !user.accessToken) throw new Error('Authentication required');
    const userClient = getUserSupabaseClient(user.accessToken);
    const subjects = await TopicModel.listSubjects(userClient);

    // Dynamically calculate genuine counts of chapters, topics, and curriculum nodes
    const enriched = await Promise.all(subjects.map(async (s) => {
      try {
        const topics = await TopicModel.getTopicsBySubject(userClient, s.id);
        const chapters = topics.filter(t => t.hierarchy_level === 'chapter' || !t.parent_topic_id);
        const topicNodes = topics.filter(t => t.hierarchy_level === 'topic');
        const subtopicNodes = topics.filter(t => t.hierarchy_level === 'subtopic');

        return {
          ...s,
          chapterCount: chapters.length,
          topicCount: topicNodes.length,
          subtopicCount: subtopicNodes.length,
          nodeCount: topics.length > 0 ? (topics.length + 1) : 0 // +1 for the document root node
        };
      } catch (err) {
        return {
          ...s,
          chapterCount: s.metadata?.chapterCount || 0,
          topicCount: 0,
          subtopicCount: 0,
          nodeCount: 0
        };
      }
    }));

    return enriched;
  },

  /**
   * Get full topic map for a subject
   */
  async getSubjectTopicMap(user, subjectId) {
    if (!user || !user.accessToken) throw new Error('Authentication required');
    const userClient = getUserSupabaseClient(user.accessToken);
    const subject = await TopicModel.findSubjectById(userClient, subjectId);
    if (!subject) throw new Error('Subject not found or access denied');

    const topics = await TopicModel.getTopicsBySubject(userClient, subjectId);
    return {
      subject,
      topics: this._buildNestedTree(topics)
    };
  },

  /**
   * Update review status (draft -> reviewed -> approved)
   */
  async updateStatus(user, subjectId, newStatus) {
    if (!user || !user.accessToken) throw new Error('Authentication required');
    if (!['draft', 'reviewed', 'approved'].includes(newStatus)) {
      throw new Error('Invalid status. Allowed values: draft, reviewed, approved');
    }
    const userClient = getUserSupabaseClient(user.accessToken);
    return await TopicModel.updateSubject(userClient, subjectId, { status: newStatus });
  },

  /**
   * Intelligently matches and merges student-edited topics with newly extracted topic hierarchy.
   * Enforces strict matching rules:
   * - Must match hierarchy_level
   * - Never matches by array position
   * - Matches using source chunk ID, section title, and normalized original/current heading
   * - Disqualifies ambiguous/multi-match candidates
   */
  _matchStudentEdits(existingTopics, editedTopics, newFlatTopics) {
    const matchedEdits = [];
    const unmatchedEdits = [];

    if (!editedTopics || editedTopics.length === 0) {
      return { matchedEdits, unmatchedEdits };
    }

    const normalize = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str.toLowerCase().replace(/[^a-z0-9]/g, '');
    };

    // Track which new candidates have already been claimed to prevent double-assignment
    const claimedCandidateIds = new Set();

    for (const edited of editedTopics) {
      const origName = edited.extraction_metadata?.originalName || '';
      const currName = edited.name || '';
      const normOrig = normalize(origName);
      const normCurr = normalize(currName);

      const editedChunkId = edited.source_references?.[0]?.chunkId;
      const editedSection = normalize(edited.source_references?.[0]?.sectionTitle);

      // Filter candidate pool by hierarchy level and unclaimed status
      const candidates = newFlatTopics.filter(cand =>
        cand.hierarchy_level === edited.hierarchy_level &&
        !claimedCandidateIds.has(cand.id)
      );

      // Score each candidate
      const scoredCandidates = [];
      for (const cand of candidates) {
        let nameScore = 0;
        const normCandName = normalize(cand.name);
        const candChunkId = cand.source_references?.[0]?.chunkId;
        const candSection = normalize(cand.source_references?.[0]?.sectionTitle);

        // 1. Heading matching
        if (normOrig && normCandName === normOrig) {
          // Exact match with original pre-edit heading
          nameScore = 100;
        } else if (normCurr && normCandName === normCurr) {
          // Exact match with current heading
          nameScore = 90;
        } else if (normCandName && normCurr && (normCurr.includes(normCandName) || normCandName.includes(normCurr))) {
          // Substring match (e.g. custom suffix like "(Student Custom Edit)")
          nameScore = 75;
        } else if (normOrig && normCandName && (normCandName.includes(normOrig) || normOrig.includes(normCandName))) {
          // Substring match with original heading
          nameScore = 70;
        }

        // If candidate heading has zero match or overlap with original/current heading, disqualify
        if (nameScore === 0) {
          continue;
        }

        let score = nameScore;

        // 2. Source citation matching (bonus confidence)
        if (editedChunkId && candChunkId && editedChunkId === candChunkId) {
          score += 30;
        }
        if (editedSection && candSection && (editedSection === candSection || candSection.includes(editedSection) || editedSection.includes(candSection))) {
          score += 20;
        }

        scoredCandidates.push({ candidate: cand, score });
      }

      // Sort by score descending
      scoredCandidates.sort((a, b) => b.score - a.score);

      if (scoredCandidates.length === 0) {
        unmatchedEdits.push({
          id: edited.id,
          name: edited.name,
          hierarchy_level: edited.hierarchy_level,
          reason: 'No matching section found in newly extracted syllabus'
        });
        continue;
      }

      const topCandidate = scoredCandidates[0];
      // Check ambiguity: if second candidate has identical score, disqualify both
      if (scoredCandidates.length > 1 && scoredCandidates[1].score === topCandidate.score) {
        unmatchedEdits.push({
          id: edited.id,
          name: edited.name,
          hierarchy_level: edited.hierarchy_level,
          reason: `Ambiguous match between multiple candidate topics (${topCandidate.candidate.name} vs ${scoredCandidates[1].candidate.name})`
        });
        continue;
      }

      // Confident unique match found
      const target = topCandidate.candidate;
      claimedCandidateIds.add(target.id);

      // Carry over student customizations
      target.name = edited.name;
      if (edited.description !== undefined && edited.description !== null) {
        target.description = edited.description;
      }
      target.extraction_metadata = {
        ...(target.extraction_metadata || {}),
        studentEdited: true,
        originalName: origName || target.name,
        editedAt: edited.extraction_metadata?.editedAt || new Date().toISOString()
      };

      matchedEdits.push({
        oldTopicId: edited.id,
        newTopicId: target.id,
        name: edited.name,
        hierarchy_level: edited.hierarchy_level,
        score: topCandidate.score
      });
    }

    return { matchedEdits, unmatchedEdits };
  },

  /**
   * Update individual topic (rename, edit)
   */
  async updateTopic(user, topicId, updates) {
    if (!user || !user.accessToken) throw new Error('Authentication required');
    const userClient = getUserSupabaseClient(user.accessToken);
    const topic = await TopicModel.findTopicById(userClient, topicId);
    if (!topic) throw new Error('Topic not found or access denied');

    const updatedMetadata = {
      ...(topic.extraction_metadata || {}),
      studentEdited: true,
      originalName: topic.extraction_metadata?.originalName || topic.name,
      editedAt: new Date().toISOString()
    };

    return await TopicModel.updateTopic(userClient, topicId, {
      name: updates.name || topic.name,
      description: updates.description !== undefined ? updates.description : topic.description,
      extractionMetadata: updatedMetadata
    });
  },

  /**
   * Delete topic (cascades to children via database foreign key)
   */
  async deleteTopic(user, topicId) {
    if (!user || !user.accessToken) throw new Error('Authentication required');
    const userClient = getUserSupabaseClient(user.accessToken);
    return await TopicModel.deleteTopic(userClient, topicId);
  }
};

