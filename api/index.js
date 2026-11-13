import { sendJson, sendError } from '../lib/helpers.js';
import { SystemController } from '../controllers/system-controller.js';
import { AuthController } from '../controllers/auth-controller.js';
import { AssistantController } from '../controllers/assistant-controller.js';
import { DocumentController } from '../controllers/document-controller.js';
import { TopicController } from '../controllers/topic-controller.js';
import { QuizController } from '../controllers/quiz-controller.js';
import { RagController } from '../controllers/rag-controller.js';
import { GapAnalysisController } from '../controllers/gap-analysis-controller.js';
import { RevisionPlanController } from '../controllers/revision-plan-controller.js';

/**
 * Normalizes request paths across local dev-server and Vercel serverless runtime
 */
export function normalizeApiPath(req) {
  // 1. Check routing headers injected by Vercel / edge proxies
  const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-original-uri'];
  if (matchedPath && matchedPath.startsWith('/api')) {
    const raw = matchedPath.split('?')[0].replace(/\/+$/, '');
    return raw || '/api';
  }

  // 2. Parse req.url
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      // Check if __route parameter was passed via vercel.json rewrite
      if (parsed.searchParams.has('__route')) {
        const routeParam = parsed.searchParams.get('__route').replace(/\/+$/, '');
        if (!routeParam) return '/api';
        return routeParam.startsWith('/api') ? routeParam : `/api/${routeParam.replace(/^\/+/, '')}`;
      }

      const pathname = parsed.pathname.replace(/\/+$/, '');
      if (pathname.startsWith('/api') && pathname !== '/api/index.js' && pathname !== '/api/index') {
        return pathname || '/api';
      }
    } catch {}
  }

  // 3. Check req.query if parsed by Vercel runtime
  if (req.query) {
    if (req.query.__route) {
      const routeParam = String(req.query.__route).replace(/\/+$/, '');
      if (!routeParam) return '/api';
      return routeParam.startsWith('/api') ? routeParam : `/api/${routeParam.replace(/^\/+/, '')}`;
    }
    if (req.query.route) {
      const r = Array.isArray(req.query.route) ? req.query.route.join('/') : String(req.query.route);
      return `/api/${r.replace(/^\/+/, '')}`;
    }
  }

  return '/api';
}

/**
 * GapFinder AI Central Catch-All API Handler
 * Consolidates all endpoints into a single Vercel Serverless Function (Hobby plan <= 12 functions)
 */
export default async function handler(req, res) {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.end();
  }

  try {
    const normalizedPath = normalizeApiPath(req).toLowerCase();

    // Reconstruct clean req.url so downstream controllers and services parse original query parameters
    try {
      const parsedOriginal = new URL(req.url, 'http://localhost');
      parsedOriginal.searchParams.delete('__route');
      const search = parsedOriginal.searchParams.toString();
      req.url = `${normalizedPath}${search ? `?${search}` : ''}`;
    } catch {}

    // Dispatch request to appropriate controller
    switch (normalizedPath) {
      case '/api':
        return sendJson(res, 200, {
          success: true,
          message: 'GapFinder AI API Gateway',
          version: '1.0.0',
          status: 'online'
        });

      case '/api/health':
        return await SystemController.health(req, res);

      case '/api/config':
        return await SystemController.config(req, res);

      case '/api/auth/check-email':
        return await AuthController.checkEmail(req, res);

      case '/api/auth/session':
        return await AuthController.session(req, res);

      case '/api/auth/signin':
        return await AuthController.signin(req, res);

      case '/api/auth/signup':
        return await AuthController.signup(req, res);

      case '/api/assistant/chat':
        return await AssistantController.chat(req, res);

      case '/api/documents/list':
        return await DocumentController.list(req, res);

      case '/api/documents/upload':
        return await DocumentController.upload(req, res);

      case '/api/documents/process':
        return await DocumentController.process(req, res);

      case '/api/documents/delete':
        return await DocumentController.delete(req, res);

      case '/api/topics/list':
        return await TopicController.list(req, res);

      case '/api/topics/extract':
        return await TopicController.extract(req, res);

      case '/api/topics/detail':
        return await TopicController.detail(req, res);

      case '/api/topics/update':
        return await TopicController.update(req, res);

      case '/api/topics/delete':
        return await TopicController.delete(req, res);

      case '/api/quiz/generate':
        return await QuizController.generate(req, res);

      case '/api/quiz/submit':
        return await QuizController.submit(req, res);

      case '/api/quiz/history':
        return await QuizController.history(req, res);

      case '/api/quiz/review':
        return await QuizController.review(req, res);

      case '/api/rag/retrieve':
        return await RagController.retrieve(req, res);

      case '/api/gap-analysis':
        return await GapAnalysisController.analyze(req, res);

      case '/api/revision-plan':
        return await RevisionPlanController.get(req, res);

      case '/api/revision-plan/generate':
        return await RevisionPlanController.generate(req, res);

      case '/api/revision-plan/task':
        return await RevisionPlanController.updateTask(req, res);

      default:
        return sendError(res, 404, `API Route Not Found: ${normalizedPath}`);
    }
  } catch (err) {
    console.error('API Gateway Unhandled Error:', err);
    return sendError(res, 500, 'Internal Server Error');
  }
}

