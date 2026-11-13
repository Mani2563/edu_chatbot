import { getUserFromRequest, getUserSupabaseClient, getSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';
import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { RetrievalService } from '../services/retrieval-service.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';
import { DocumentModel } from '../models/document-model.js';
import { getGroqModel, isGroqConfigured } from '../lib/groq.js';
import { generateText } from 'ai';
import { z } from 'zod';

const isValidUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(1000, 'Message too long'),
  documentId: z.string().nullable().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional().default([])
});

export const AssistantController = {
  /**
   * POST /api/assistant/chat
   * Context-grounded pedagogical AI learning assistant
   */
  async chat(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      // 1. Authenticate user (supports active session or guest student session)
      const user = await getUserFromRequest(req).catch(() => null);
      const activeUser = user || { id: 'anonymous-student', accessToken: null };
      const userClient = user?.accessToken ? getUserSupabaseClient(user.accessToken) : (getSupabaseAdmin() || getSupabaseClient());

      // 2. Validate input
      const body = await parseRequestBody(req);
      const validation = ChatRequestSchema.safeParse(body);
      if (!validation.success) {
        const msg = validation.error.issues.map(i => i.message).join(', ');
        return sendError(res, 400, msg);
      }

      const { message, documentId, history } = validation.data;
      const cleanMessage = message.trim();
      const lowerMsg = cleanMessage.toLowerCase().replace(/[!.,?]+$/, '').trim();

      // Detect simple greetings, pleasantries, or salutations
      const GREETING_REGEX = /^(hi|hello|helo|hey|howdy|hola|namaste|greetings|good\s*(morning|afternoon|evening|day)|yo|sup|hiya)(\s+[a-z]+)*$/i;
      const isGreeting = GREETING_REGEX.test(lowerMsg) ||
        ['hi', 'hello', 'helo', 'hey', 'good morning', 'good afternoon', 'good evening', 'who are you', 'what can you do', 'help'].includes(lowerMsg);

      // 3. Fetch Document Details & Chunks
      let targetDoc = null;
      let relevantChunks = [];
      let citations = [];

      if (documentId && isValidUuid(documentId)) {
        targetDoc = await DocumentModel.findById(userClient, documentId).catch(() => null);

        // Only retrieve content chunks if the user is asking an actual question (not just saying hello)
        if (!isGreeting) {
          // Attempt 1: Search using BM25 retrieval
          const docIds = [documentId];
          if (activeUser.accessToken) {
            const retrievalResult = await RetrievalService.retrieveEvidence(activeUser, cleanMessage, {
              documentIds: docIds,
              topK: 4
            }).catch(() => null);

            if (retrievalResult && retrievalResult.hasEvidence && retrievalResult.results.length > 0) {
              relevantChunks = retrievalResult.results;
            }
          }

          // Attempt 2: If keyword search had no direct match, fetch primary chunks for grounding
          if (relevantChunks.length === 0) {
            const allDocChunks = await DocumentChunkModel.getChunksByUser(userClient, activeUser.id, docIds).catch(() => []);
            if (allDocChunks && allDocChunks.length > 0) {
              relevantChunks = allDocChunks.slice(0, 4);
            }
          }
        }
      } else if (!isGreeting) {
        // General search across all user's documents
        if (activeUser.accessToken) {
          const retrievalResult = await RetrievalService.retrieveEvidence(activeUser, cleanMessage, {
            topK: 4
          }).catch(() => null);

          if (retrievalResult && retrievalResult.hasEvidence && retrievalResult.results.length > 0) {
            relevantChunks = retrievalResult.results;
          }
        }
      }

      // Handle simple greetings directly and concisely without unsolicited content dumps
      if (isGreeting) {
        const docName = targetDoc?.file_name;
        const greetingReply = docName
          ? `Hello! I'm your AI learning assistant for **${docName}**.\n\nI'm ready to help you understand this chapter, explain key concepts, or solve practice problems. What would you like to explore or learn today?`
          : `Hello! I'm your GapFinder AI Assistant. I can help explain concepts from your uploaded study materials and answer your learning questions. What would you like help with today?`;

        return sendJson(res, 200, {
          success: true,
          reply: greetingReply,
          citations: [],
          documentName: docName || null
        });
      }

      // Prepare citations
      if (relevantChunks.length > 0) {
        citations = relevantChunks.slice(0, 2).map(c => ({
          sectionTitle: c.section_title || 'Curriculum Section',
          pageNumber: c.page_number || null,
          documentName: targetDoc?.file_name || 'Study Material'
        }));
      }

      // 4. Generate Pedagogical AI Explanation with Groq
      let replyText = '';
      const groqModel = getGroqModel();

      if (isGroqConfigured() && groqModel) {
        const docContextStr = relevantChunks.length > 0
          ? relevantChunks.map((c, i) =>
              `--- [EXCERPT ${i + 1}] (Section: ${c.section_title || 'N/A'}, Page: ${c.page_number || 'N/A'}) ---\n${c.content.slice(0, 700)}`
            ).join('\n\n')
          : 'No specific document excerpts found matching this query.';

        const docName = targetDoc?.file_name || 'study materials';

        const systemPrompt = `You are GapFinder AI Assistant, an expert, patient, and pedagogical learning tutor.
Your goal is to explain concepts clearly, simply, and accurately, helping students overcome learning gaps.

FORMATTING & CLARITY RULES:
1. Always give a direct, friendly, and complete answer to the student's question.
2. DO NOT output useless raw markdown symbols like "##", "###", "---", or LaTeX markup like "\\[", "\\]", "\\(", "\\)", "\\dfrac", "\\times".
3. Write clean, readable headings naturally without hashes (e.g. "Learning Objectives" or "Why This Matters").
4. For lists, write clean bullets using "• " or numbers "1. ", "2. ".
5. For math, write standard arithmetic (e.g. "12 / 40 = 30%").
6. Ground your explanation in the student's uploaded document "${docName}" when context is provided.
7. Keep the tone supportive, encouraging, and easy to understand.
8. DO NOT use ASCII markdown tables with vertical bars '|' and dashes '---'. Present items with clean bullet lists instead.`;

        const userPrompt = `STUDENT QUESTION: "${cleanMessage}"

DOCUMENT CONTEXT FROM "${docName}":
${docContextStr}

Please provide a clear, helpful, and grounded tutoring response to help the student understand this concept:`;

        try {
          const { text } = await generateText({
            model: groqModel,
            system: systemPrompt,
            prompt: userPrompt,
            temperature: 0.3
          });
          replyText = text;
        } catch (llmErr) {
          console.warn('Groq LLM call failed in assistant chat:', llmErr.message);
        }
      }

      // 5. Fallback deterministic explanation if Groq is unavailable
      if (!replyText) {
        if (relevantChunks.length > 0) {
          const topChunk = relevantChunks[0];
          const pageStr = topChunk.page_number ? ` (Page ${topChunk.page_number})` : '';
          replyText = `Based on your uploaded material ${targetDoc?.file_name || 'study notes'}${pageStr}:\n\n` +
            `${topChunk.content.slice(0, 350)}...\n\n` +
            `Key Takeaway: Review this section in your document to reinforce your understanding. You can also take a diagnostic quiz to test your mastery!`;
        } else {
          replyText = `I reviewed ${targetDoc?.file_name || 'your uploaded study materials'} for "${cleanMessage}".\n\n` +
            `Tip: To get the most accurate answers, ask about specific concepts, formulas, or chapter topics found in your document, or click "Take Quiz" to diagnose your understanding!`;
        }
      }

      // Clean any lingering raw LaTeX or formatting symbols before sending
      const cleanedReply = replyText
        .replace(/\\\[/g, '')
        .replace(/\\\]/g, '')
        .replace(/\\\(/g, '')
        .replace(/\\\)/g, '')
        .replace(/\\dfrac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2')
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2')
        .replace(/\\times/g, '×')
        .replace(/\\div/g, '÷')
        .replace(/\\text\{([^}]+)\}/g, '$1')
        .replace(/\\displaystyle/g, '')
        .replace(/\\%/g, '%')
        .replace(/\r\n/g, '\n');

      return sendJson(res, 200, {
        success: true,
        reply: cleanedReply,
        citations: citations,
        documentName: targetDoc?.file_name || null
      });

    } catch (err) {
      console.error('Assistant Chat Error:', err.message);
      return sendError(res, 500, `AI Assistant service error: ${err.message}`);
    }
  }
};

