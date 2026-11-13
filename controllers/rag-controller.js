import { getUserFromRequest } from '../lib/supabase.js';
import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { RetrievalService } from '../services/retrieval-service.js';
import { z } from 'zod';

const RetrieveQuerySchema = z.object({
  query: z.string().min(1, 'Query string is required').max(500, 'Query exceeds 500 characters'),
  documentIds: z.array(z.string().uuid('Invalid document UUID')).optional().default([]),
  topK: z.number().int().min(1).max(20).optional().default(5)
});

export const RagController = {
  /**
   * POST /api/rag/retrieve
   * Deterministic BM25 retrieval over user's indexed study chunks with source citations
   */
  async retrieve(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      // 1. Authenticate user from Bearer JWT
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid Supabase session required');
      }

      // 2. Validate request body
      const body = await parseRequestBody(req);
      const validation = RetrieveQuerySchema.safeParse(body);

      if (!validation.success) {
        const msg = validation.error.issues.map(i => i.message).join(', ');
        return sendError(res, 400, msg);
      }

      const { query, documentIds, topK } = validation.data;

      // 3. Retrieve evidence
      const result = await RetrievalService.retrieveEvidence(user, query, {
        documentIds,
        topK
      });

      return sendJson(res, 200, result);
    } catch (err) {
      console.error('RAG Retrieval Controller Error:', err.message);
      return sendError(res, 500, err.message);
    }
  }
};

