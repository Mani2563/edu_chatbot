import { sendJson, sendError } from '../lib/helpers.js';
import { isGroqConfigured } from '../lib/groq.js';
import { isSupabaseConfigured, getPublicConfig } from '../lib/supabase.js';

export const SystemController = {
  /**
   * GET /api/health
   * System health check and environment verification
   */
  async health(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
    }

    return sendJson(res, 200, {
      success: true,
      message: 'GapFinder AI backend is running',
      services: {
        groqConfigured: isGroqConfigured(),
        supabaseConfigured: isSupabaseConfigured(),
        environment: process.env.NODE_ENV || 'development'
      }
    });
  },

  /**
   * GET /api/config
   * Public Supabase configuration for client hydration
   */
  async config(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    const publicConfig = getPublicConfig();
    return sendJson(res, 200, {
      success: true,
      config: {
        supabaseUrl: publicConfig.supabaseUrl,
        supabaseAnonKey: publicConfig.supabaseAnonKey
      }
    });
  }
};

