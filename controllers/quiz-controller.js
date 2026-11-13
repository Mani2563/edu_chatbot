import { getUserFromRequest } from '../lib/supabase.js';
import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { QuizService } from '../services/quiz-service.js';

export const QuizController = {
  /**
   * POST /api/quiz/generate
   * Generates a grounded diagnostic quiz for a topic or chapter
   */
  async generate(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const body = await parseRequestBody(req);
      const sanitizedPayload = {
        subjectId: body.subjectId,
        documentId: body.documentId,
        chapterId: body.chapterId,
        topicId: body.topicId,
        difficulty: body.difficulty,
        questionCount: body.questionCount
      };
      const result = await QuizService.generateQuiz(user, sanitizedPayload);

      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Quiz Generation Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * POST /api/quiz/submit
   * Submits student answers, calculates score, and returns grounded review
   */
  async submit(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const body = await parseRequestBody(req);
      const sanitizedPayload = {
        attemptId: body.attemptId,
        answers: Array.isArray(body.answers) ? body.answers.map(a => ({
          questionId: a?.questionId,
          selectedOption: a?.selectedOption
        })) : []
      };
      const result = await QuizService.submitQuiz(user, sanitizedPayload);

      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Quiz Submission Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * GET /api/quiz/history
   * Retrieves past attempts for the authenticated student
   */
  async history(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const subjectId = parsedUrl.searchParams.get('subjectId');
      const topicId = parsedUrl.searchParams.get('topicId');

      const result = await QuizService.getQuizHistory(user, { subjectId, topicId });
      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Quiz History Controller Error:', err.message);
      return sendError(res, 500, err.message);
    }
  },

  /**
   * GET /api/quiz/review
   * Retrieves full review for a completed quiz attempt
   * Rejects in-progress attempts (prevents pre-submission answer leakage)
   */
  async review(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid student session required');
      }

      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const attemptId = parsedUrl.searchParams.get('attemptId');
      if (!attemptId) {
        return sendError(res, 400, 'Attempt ID is required');
      }

      const result = await QuizService.getQuizReview(user, attemptId);
      return sendJson(res, 200, result);
    } catch (err) {
      console.error('Quiz Review Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  }
};

