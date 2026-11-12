import { sendJson } from '../lib/helpers.js';
import { isGroqConfigured } from '../lib/groq.js';
import { isSupabaseConfigured } from '../lib/supabase.js';

export default async function handler(req, res) {
  // Allow only GET requests
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
}

