import { sendJson, sendError } from '../../lib/helpers.js';
import { getUserFromRequest } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return sendError(res, 405, 'Method Not Allowed');
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return sendError(res, 401, 'Unauthorized: Invalid or missing session token');
  }

  return sendJson(res, 200, {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      user_metadata: user.user_metadata
    }
  });
}

