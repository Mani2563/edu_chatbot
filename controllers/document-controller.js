import { getUserFromRequest } from '../lib/supabase.js';
import { sendJson, sendError, parseRequestBody } from '../lib/helpers.js';
import { DocumentService } from '../services/document-service.js';

export const DocumentController = {
  /**
   * POST /api/documents/upload
   * Compatibility endpoint: documents are uploaded directly to Supabase Storage client-side,
   * then registered via /api/documents/process
   */
  async upload(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }
    return sendJson(res, 200, {
      success: true,
      message: 'Direct upload protocol active. Upload file bytes to Supabase Storage, then invoke /api/documents/process'
    });
  },

  /**
   * POST /api/documents/process
  /**
   * POST /api/documents/process
   * Handles text extraction and metadata storage after direct Storage upload
   */
  async process(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid Supabase session required');
      }

      const body = await parseRequestBody(req);
      const result = await DocumentService.processDocument(user, body);

      const statusCode = result.success ? 200 : 422;
      return sendJson(res, statusCode, result);
    } catch (err) {
      console.error('Process Document Controller Error:', err.message);
      return sendError(res, 400, err.message);
    }
  },

  /**
   * GET /api/documents/list
   * Returns list of user's uploaded documents
   */
  async list(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid Supabase session required');
      }

      const documents = await DocumentService.listDocuments(user);
      return sendJson(res, 200, {
        success: true,
        count: documents.length,
        documents
      });
    } catch (err) {
      console.error('List Documents Controller Error:', err.message);
      return sendError(res, 500, err.message);
    }
  },

  /**
   * DELETE /api/documents/delete
   * Deletes document record and corresponding Storage object
   */
  async delete(req, res) {
    if (req.method !== 'DELETE' && req.method !== 'POST') {
      res.setHeader('Allow', ['DELETE', 'POST']);
      return sendError(res, 405, 'Method Not Allowed');
    }

    try {
      const user = await getUserFromRequest(req);
      if (!user) {
        return sendError(res, 401, 'Unauthorized: Valid Supabase session required');
      }

      const url = new URL(req.url, `http://${req.headers.host}`);
      let documentId = url.searchParams.get('id');
      let confirmDiscard = url.searchParams.get('confirmDiscard') === 'true';

      if (!documentId) {
        const body = await parseRequestBody(req);
        documentId = body?.documentId;
        if (body?.confirmDiscard !== undefined) {
          confirmDiscard = Boolean(body.confirmDiscard);
        }
      }

      if (!documentId) {
        return sendError(res, 400, 'Missing required parameter: id');
      }

      const success = await DocumentService.deleteDocument(user, documentId, { confirmDiscard });
      return sendJson(res, 200, {
        success,
        message: success ? 'Document, associated topics, and storage object deleted successfully' : 'Document not found'
      });
    } catch (err) {
      console.error('Delete Document Controller Error:', err.message);
      if (err.code === 'CONFIRMATION_REQUIRED' || err.status === 409) {
        return sendJson(res, 409, {
          success: false,
          code: 'CONFIRMATION_REQUIRED',
          message: err.message,
          details: err.details
        });
      }
      return sendError(res, 400, err.message);
    }
  }
};
