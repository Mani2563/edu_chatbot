import { getUserFromRequest } from '../lib/supabase.js';
import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { RevisionPlanService } from '../services/revision-plan-service.js';

export const RevisionPlanController = {
  /**
   * POST /api/revision-plan/generate
   * Generates a grounded, day-wise revision schedule based on Phase 6 diagnostic results
   */
  async generate(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user || !user.id) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const body = await parseRequestBody(req);
      const { subjectId, availableDays, hoursPerDay } = body || {};

      if (!subjectId) {
        return sendError(res, 400, 'Subject ID is required to generate a revision plan');
      }

      const plan = await RevisionPlanService.generatePlan(user, {
        subjectId,
        availableDays: availableDays || 5,
        hoursPerDay: hoursPerDay || 2
      });

      return sendJson(res, 200, {
        success: true,
        plan
      });
    } catch (err) {
      console.error('Revision Plan Generate Controller Error:', err.message);
      if (err.message.includes('not found or access denied')) {
        return sendError(res, 403, err.message);
      }
      return sendError(res, 400, err.message);
    }
  },

  /**
   * GET /api/revision-plan?subjectId=...
   * Retrieves active revision plan for student and subject
   */
  async get(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user || !user.id) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
      const subjectId = parsedUrl.searchParams.get('subjectId');

      if (!subjectId) {
        return sendError(res, 400, 'Subject ID is required');
      }

      const plan = await RevisionPlanService.getPlan(user, subjectId);

      return sendJson(res, 200, {
        success: true,
        plan
      });
    } catch (err) {
      console.error('Revision Plan Get Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * PATCH /api/revision-plan/task
   * Marks a revision task as completed or pending
   */
  async updateTask(req, res) {
    if (req.method !== 'PATCH' && req.method !== 'POST') {
      res.setHeader('Allow', ['PATCH', 'POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user || !user.id) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const body = await parseRequestBody(req);
      const { planId, taskId, isCompleted } = body || {};

      if (!planId || !taskId) {
        return sendError(res, 400, 'Plan ID and Task ID are required');
      }

      const result = await RevisionPlanService.updateTaskStatus(user, {
        planId,
        taskId,
        isCompleted: Boolean(isCompleted)
      });

      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Revision Plan Update Task Controller Error:', err.message);
      if (err.message.includes('not found or access denied')) {
        return sendError(res, 403, err.message);
      }
      return sendError(res, 400, err.message);
    }
  }
};

