import { sendJson, sendError, parseRequestBody } from '../../lib/helpers.js';
import { getSupabaseAdmin } from '../../lib/supabase.js';
import { z } from 'zod';

const CheckEmailSchema = z.object({
  email: z.string().email('Invalid email address')
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return sendError(res, 405, 'Method Not Allowed');
  }

  try {
    const body = await parseRequestBody(req);
    const validation = CheckEmailSchema.safeParse(body);

    if (!validation.success) {
      return sendError(res, 400, 'Please provide a valid email address');
    }

    const { email } = validation.data;
    const admin = getSupabaseAdmin();

    if (!admin) {
      return sendJson(res, 200, { success: true, exists: null });
    }

    // List users from Supabase Auth admin API to verify email existence
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) {
      console.warn('Check email admin API error:', error.message);
      return sendJson(res, 200, { success: true, exists: null });
    }

    const target = email.toLowerCase().trim();
    const userFound = (data.users || []).some(u => u.email && u.email.toLowerCase().trim() === target);

    return sendJson(res, 200, {
      success: true,
      email: target,
      exists: userFound
    });
  } catch (err) {
    console.error('Check email endpoint error:', err.message);
    return sendError(res, 500, 'Error checking email existence');
  }
}
