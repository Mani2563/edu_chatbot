import { sendJson, sendError, parseRequestBody } from '../../lib/helpers.js';
import { getSupabaseClient } from '../../lib/supabase.js';
import { z } from 'zod';

const SignUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().optional()
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return sendError(res, 405, 'Method Not Allowed');
  }

  try {
    const body = await parseRequestBody(req);
    const validation = SignUpSchema.safeParse(body);

    if (!validation.success) {
      const msg = validation.error.issues.map(i => i.message).join(', ');
      return sendError(res, 400, msg);
    }

    const { email, password, fullName } = validation.data;
    const supabase = getSupabaseClient();

    if (!supabase) {
      return sendError(res, 500, 'Supabase Auth is not configured on the server');
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || 'Student'
        }
      }
    });

    if (error) {
      return sendError(res, 400, error.message);
    }

    return sendJson(res, 201, {
      success: true,
      message: data.session ? 'Account created and signed in' : 'Registration successful. Please check your email for confirmation.',
      user: {
        id: data.user?.id,
        email: data.user?.email,
        user_metadata: data.user?.user_metadata || {}
      },
      session: data.session ? {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      } : null
    });
  } catch (err) {
    console.error('Sign Up Error:', err.message);
    return sendError(res, 500, 'Internal registration error');
  }
}

