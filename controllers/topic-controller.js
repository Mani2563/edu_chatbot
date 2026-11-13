import { getUserFromRequest } from '../lib/supabase.js';
import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { TopicService } from '../services/topic-service.js';
import { z } from 'zod';

const ExtractTopicSchema = z.object({
  sourceDocumentId: z.string().uuid('Valid source document UUID is required'),
  forceReextract: z.boolean().optional().default(false),
  confirmDiscardEdits: z.boolean().optional().default(false)
});

const UpdateTopicSchema = z.object({
  topicId: z.string().uuid('Valid topic UUID is required').optional(),
  subjectId: z.string().uuid('Valid subject UUID is required').optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'reviewed', 'approved']).optional()
});

export const TopicController = {
  /**
   * POST /api/topics/extract
   */
  async extract(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) return sendError(res, 401, 'Unauthorized: Valid Supabase session required');

      const body = await parseRequestBody(req);
      const validation = ExtractTopicSchema.safeParse(body);
      if (!validation.success) {
        const msg = validation.error.issues.map(i => i.message).join(', ');
        return sendError(res, 400, msg);
      }

      const { sourceDocumentId, forceReextract, confirmDiscardEdits } = validation.data;
      const result = await TopicService.extractTopicMap(user, sourceDocumentId, {
        forceReextract,
        confirmDiscardEdits
      });

      let statusCode = 200;
      if (!result.success) {
        if (result.status === 'insufficient_structure') {
          statusCode = 422;
        } else if (result.status === 'unmatched_edits_detected') {
          statusCode = 409;
        } else if (result.status === 'concurrent_incomplete') {
          statusCode = 409;
        } else {
          statusCode = 400;
        }
      }
      return sendJson(res, statusCode, result);
    } catch (err) {
      console.error('Extract Topic Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * GET /api/topics/list
   */
  async list(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) return sendError(res, 401, 'Unauthorized: Valid Supabase session required');

      const subjects = await TopicService.listSubjects(user);
      return sendJson(res, 200, {
        success: true,
        count: subjects.length,
        subjects
      });
    } catch (err) {
      console.error('List Subjects Controller Error:', err.message);
      return sendError(res, 500, err.message);
    }
  },

  /**
   * GET /api/topics/detail?id=...
   */
  async detail(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) return sendError(res, 401, 'Unauthorized: Valid Supabase session required');

      const url = new URL(req.url, `http://${req.headers.host}`);
      const subjectId = url.searchParams.get('id');
      if (!subjectId) return sendError(res, 400, 'Missing parameter: id');

      const topicMap = await TopicService.getSubjectTopicMap(user, subjectId);
      return sendJson(res, 200, {
        success: true,
        ...topicMap
      });
    } catch (err) {
      console.error('Topic Detail Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * PATCH /api/topics/update
   */
  async update(req, res) {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
      res.setHeader('Allow', ['PATCH', 'POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) return sendError(res, 401, 'Unauthorized: Valid Supabase session required');

      const body = await parseRequestBody(req);
      const validation = UpdateTopicSchema.safeParse(body);
      if (!validation.success) {
        const msg = validation.error.issues.map(i => i.message).join(', ');
        return sendError(res, 400, msg);
      }

      // Update subject status (draft -> reviewed -> approved)
      if (validation.data.subjectId && validation.data.status) {
        const updated = await TopicService.updateStatus(user, validation.data.subjectId, validation.data.status);
        return sendJson(res, 200, { success: true, subject: updated });
      }

      // Update topic name/description
      if (validation.data.topicId) {
        const updated = await TopicService.updateTopic(user, validation.data.topicId, {
          name: validation.data.name,
          description: validation.data.description
        });
        return sendJson(res, 200, { success: true, topic: updated });
      }

      return sendError(res, 400, 'Must provide either topicId or subjectId + status to update');
    } catch (err) {
      console.error('Update Topic Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * DELETE /api/topics/delete?id=...
   */
  async delete(req, res) {
    if (req.method !== 'DELETE' && req.method !== 'POST') {
      res.setHeader('Allow', ['DELETE', 'POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) return sendError(res, 401, 'Unauthorized: Valid Supabase session required');

      const url = new URL(req.url, `http://${req.headers.host}`);
      let topicId = url.searchParams.get('id');
      if (!topicId) {
        const body = await parseRequestBody(req);
        topicId = body?.id || body?.topicId;
      }

      if (!topicId) return sendError(res, 400, 'Missing parameter: id');

      const success = await TopicService.deleteTopic(user, topicId);
      return sendJson(res, 200, {
        success,
        message: success ? 'Topic deleted successfully' : 'Topic not found'
      });
    } catch (err) {
      console.error('Delete Topic Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  }
};

