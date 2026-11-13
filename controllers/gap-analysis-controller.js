import { getUserFromRequest } from '../lib/supabase.js';
import { sendJson, sendError } from '../lib/helpers.js';
import { GapAnalysisService } from '../services/gap-analysis-service.js';

export const GapAnalysisController = {
  /**
   * GET /api/gap-analysis?subjectId=<subject-id>&attemptId=<attempt-id>
   * Analyzes student diagnostic quiz performance and produces topic-level gap diagnosis
   */
  async analyze(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      // 1. Authenticate student session via Supabase JWT
      const user = await getUserFromRequest(req);
      if (!user || !user.id) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      // 2. Parse query parameters
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
      const subjectId = parsedUrl.searchParams.get('subjectId');
      const attemptId = parsedUrl.searchParams.get('attemptId');
      const weakCeiling = parsedUrl.searchParams.get('weakCeiling');
      const strongFloor = parsedUrl.searchParams.get('strongFloor');
      const minQuestions = parsedUrl.searchParams.get('minQuestions');

      if (!subjectId) {
        return sendError(res, 400, 'Subject ID is required for gap analysis');
      }

      // 3. Configurable thresholds
      const thresholds = {};
      if (weakCeiling && !isNaN(Number(weakCeiling))) thresholds.weakCeiling = Number(weakCeiling);
      if (strongFloor && !isNaN(Number(strongFloor))) thresholds.strongFloor = Number(strongFloor);
      if (minQuestions && !isNaN(Number(minQuestions))) thresholds.minQuestions = Number(minQuestions);

      // 4. Generate diagnosis
      const result = await GapAnalysisService.generateGapAnalysis(user, {
        subjectId,
        attemptId: attemptId || null,
        thresholds
      });

      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Gap Analysis Controller Error:', err.message);
      if (err.message.includes('not found or access denied')) {
        return sendError(res, 403, err.message);
      }
      return sendError(res, 400, err.message);
    }
  }
};

