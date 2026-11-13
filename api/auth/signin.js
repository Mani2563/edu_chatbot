import { sendJson, sendError, parseRequestBody } from '../../lib/helpers.js';
import { getSupabaseClient } from '../../lib/supabase.js';
import { z } from 'zod';

const SignInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return sendError(res, 405, 'Method Not Allowed');
  }

  try {
    const body = await parseRequestBody(req);
    const validation = SignInSchema.safeParse(body);

    if (!validation.success) {
      const msg = validation.error.issues.map(i => i.message).join(', ');
      return sendError(res, 400, msg);
    }

    const { email, password } = validation.data;
    const supabase = getSupabaseClient();

    if (!supabase) {
      return sendError(res, 500, 'Supabase Auth is not configured on the server');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return sendError(res, 401, error.message);
    }

    return sendJson(res, 200, {
      success: true,
      message: 'Signed in successfully',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: {
          id: data.user.id,
          email: data.user.email,
          user_metadata: data.user.user_metadata || {}
        }
      }
    });
  } catch (err) {
    console.error('Sign In Error:', err.message);
    return sendError(res, 500, 'Internal authentication error');
  }
}

