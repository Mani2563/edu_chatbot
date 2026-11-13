import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { getSupabaseAdmin, getSupabaseClient, getUserFromRequest } from '../lib/supabase.js';
import { z } from 'zod';

const CheckEmailSchema = z.object({
  email: z.string().email('Invalid email address')
});

const SignInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

// Authoritative password policy schema
// Authoritatively enforces: minimum 8 characters, >=1 uppercase, >=1 lowercase, >=1 number
const PasswordSchema = z.string()
  .min(8, 'Password must be at least 8 characters long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter (A-Z)')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter (a-z)')
  .regex(/[0-9]/, 'Password must contain at least one number (0-9)');

const SignUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: PasswordSchema,
  fullName: z.string().optional()
});

export const AuthController = {
  /**
   * POST /api/auth/check-email
   * Redesigned to protect student privacy and prevent email enumeration (OWASP compliance)
   * Validates format without revealing whether the email exists in the user directory
   */
  async checkEmail(req, res) {
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

      // Strictly secured against enumeration: do NOT query or reveal user directory
      return sendJson(res, 200, {
        success: true,
        message: 'Endpoint secured against user directory enumeration'
      });
    } catch (err) {
      console.error('Check email controller error:', err.message);
      return sendError(res, 500, 'Error validating email address');
    }
  },

  /**
   * GET /api/auth/session
   * Get active authenticated user session
   */
  async session(req, res) {
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
  },

  /**
   * POST /api/auth/signin
   * Sign in user with email and password
   */
  async signin(req, res) {
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
  },

  /**
   * POST /api/auth/signup
   * Register new user account
   */
  async signup(req, res) {
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
};

