import { sendJson, sendError } from '../lib/helpers.js';
import { getPublicConfig } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return sendError(res, 405, 'Method Not Allowed');
  }

  const config = getPublicConfig();
  return sendJson(res, 200, {
    success: true,
    config: {
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey
    }
  });
}

