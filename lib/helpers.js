import dotenv from 'dotenv';
dotenv.config();

/**
 * Standard JSON response helper for Vercel Serverless Functions
 */
export function sendJson(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

/**
 * Standard safe error response helper
 * Never leaks internal stack traces or secrets to the client
 */
export function sendError(res, statusCode, message, details = null) {
  const payload = {
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  };
  if (details && process.env.NODE_ENV !== 'production') {
    payload.details = details;
  }
  return sendJson(res, statusCode, payload);
}

/**
 * Safe JSON request body parser for Node / Vercel Serverless Functions
 */
export async function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) { // 20MB limit
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', err => reject(err));
  });
}

