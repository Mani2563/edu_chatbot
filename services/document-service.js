import { getUserSupabaseClient } from '../lib/supabase.js';
import { parseDocument } from '../lib/document-parser.js';
import { DocumentModel } from '../models/document-model.js';
import { ChunkService } from './chunk-service.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';
import { TopicModel } from '../models/topic-model.js';
import { z } from 'zod';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ProcessDocumentSchema = z.object({
  documentId: z.string().uuid('Invalid document UUID'),
  storagePath: z.string().min(5, 'Invalid storage path'),
  fileName: z.string().min(1, 'Filename is required').max(255),
  fileType: z.enum(['pdf', 'docx', 'txt'])
});

export const DocumentService = {
  /**
   * Process a document that was uploaded directly to Supabase Storage by the authenticated frontend
   * Enforces idempotency, server-side verification of storage object, and safe status transitions
   */
  async processDocument(user, payload) {
    if (!user || !user.id || !user.accessToken) {
      throw new Error('Authentication required');
    }

    // 1. Validate payload schema
    const validation = ProcessDocumentSchema.safeParse(payload);
    if (!validation.success) {
      const errorMsg = validation.error.issues.map(i => i.message).join(', ');
      throw new Error(`Validation failed: ${errorMsg}`);
    }

    const { documentId, storagePath, fileName, fileType } = validation.data;

    // 2. Strict Ownership Check: Path must begin with user's UUID
    const pathSegments = storagePath.split('/');
    if (pathSegments.length < 3 || pathSegments[0] !== user.id) {
      throw new Error('Security Error: Storage path does not belong to the authenticated user');
    }

    // Verify document ID in path matches documentId
    if (pathSegments[1] !== documentId) {
      throw new Error('Security Error: Document ID mismatch in storage path');
    }

    const userClient = getUserSupabaseClient(user.accessToken);

    // 3. Idempotency Check: Check if document already exists
    let existingDoc = await DocumentModel.findByStoragePath(userClient, storagePath);

    if (existingDoc) {
      if (existingDoc.processing_status === 'completed') {
        return {
          success: true,
          idempotent: true,
          message: 'Document already processed successfully',
          document: existingDoc
        };
      }
      if (existingDoc.processing_status === 'processing') {
        return {
          success: true,
          idempotent: true,
          message: 'Document processing is currently in progress',
          document: existingDoc
        };
      }
      // If status is failed, allow retry by updating status back to processing
      await DocumentModel.updateStatus(userClient, existingDoc.id, {
        processingStatus: 'processing',
        errorMessage: null
      });
    }

    // 4. Download and verify the actual Storage object (Never trust frontend metadata)
    let fileBuffer;
    try {
      const { data: downloadData, error: downloadErr } = await userClient.storage
        .from('study-materials')
        .download(storagePath);

      if (downloadErr || !downloadData) {
        throw new Error(downloadErr ? downloadErr.message : 'File could not be downloaded from storage');
      }

      const arrayBuffer = await downloadData.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
      if (existingDoc) {
        await DocumentModel.updateStatus(userClient, existingDoc.id, {
          processingStatus: 'failed',
          errorMessage: `Storage retrieval failed: ${err.message}`
        });
      }
      throw err;
    }

    // 5. Server-side file verification
    const actualSize = fileBuffer.length;
    if (actualSize === 0) {
      // Cannot create public.documents record with 0 bytes (violates check constraint file_size > 0)
      const errMessage = 'Uploaded file is completely empty (0 bytes). Cannot be processed.';
      if (existingDoc) {
        await DocumentModel.updateStatus(userClient, existingDoc.id, {
          processingStatus: 'failed',
          errorMessage: errMessage
        });
        return { success: false, error: errMessage, document: existingDoc };
      }
      // Remove empty file from storage
      await userClient.storage.from('study-materials').remove([storagePath]);
      throw new Error(errMessage);
    }

    if (actualSize > MAX_FILE_SIZE_BYTES) {
      const errMessage = `File size (${(actualSize / (1024 * 1024)).toFixed(2)}MB) exceeds 10MB limit`;
      if (existingDoc) {
        await DocumentModel.updateStatus(userClient, existingDoc.id, {
          processingStatus: 'failed',
          errorMessage: errMessage
        });
        return { success: false, error: errMessage, document: existingDoc };
      }
      await userClient.storage.from('study-materials').remove([storagePath]);
      throw new Error(errMessage);
    }

    const detectedExt = fileName.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(detectedExt)) {
      const errMessage = `Unsupported file extension: .${detectedExt}`;
      if (existingDoc) {
        await DocumentModel.updateStatus(userClient, existingDoc.id, {
          processingStatus: 'failed',
          errorMessage: errMessage
        });
        return { success: false, error: errMessage, document: existingDoc };
      }
      await userClient.storage.from('study-materials').remove([storagePath]);
      throw new Error(errMessage);
    }

    // 6. Ensure initial DB record exists with verified file_size > 0
    if (!existingDoc) {
      try {
        existingDoc = await DocumentModel.createDocument(userClient, {
          id: documentId,
          userId: user.id,
          fileName: fileName,
          storagePath: storagePath,
          fileType: detectedExt,
          fileSize: actualSize,
          processingStatus: 'processing'
        });
      } catch (insertErr) {
        console.error('Failed to create DB record, cleaning up storage object:', insertErr.message);
        await userClient.storage.from('study-materials').remove([storagePath]);
        throw insertErr;
      }
    }

    // 7. Text extraction
    try {
      const pages = await parseDocument(fileBuffer, fileName);
      const fullText = pages.map(p => p.text).join('\n\n').trim();

      if (!fullText || fullText.length < 20) {
        throw new Error('Document contained insufficient readable text (< 20 characters)');
      }

      // 8. Generate and persist semantic chunks with source citations
      const chunkResult = await ChunkService.createAndStoreChunks(
        userClient,
        user,
        existingDoc.id,
        pages,
        fileName
      );

      // 9. Update status to completed
      const updatedDoc = await DocumentModel.updateStatus(userClient, existingDoc.id, {
        processingStatus: 'completed',
        extractedText: fullText,
        fileSize: actualSize,
        fileType: detectedExt,
        errorMessage: null
      });

      return {
        success: true,
        message: 'Document processed successfully',
        document: updatedDoc,
        pagesExtracted: pages.length,
        characterCount: fullText.length,
        chunkCount: chunkResult.chunkCount
      };
    } catch (extractErr) {
      // 9. On extraction failure: preserve original file and DB record with failed status
      console.warn('Document extraction failed:', extractErr.message);
      const failedDoc = await DocumentModel.updateStatus(userClient, existingDoc.id, {
        processingStatus: 'failed',
        errorMessage: `Extraction failed: ${extractErr.message}`,
        fileSize: actualSize,
        fileType: detectedExt
      });

      return {
        success: false,
        error: extractErr.message,
        document: failedDoc
      };
    }
  },

  /**
   * List all documents for the authenticated user
   */
  async listDocuments(user) {
    if (!user || !user.accessToken) {
      throw new Error('Authentication required');
    }
    const userClient = getUserSupabaseClient(user.accessToken);
    return await DocumentModel.listUserDocuments(userClient);
  },

  /**
   * Delete a document and its corresponding Storage object, chunks, and topic hierarchy
   * Strictly enforces safety checks to prevent silent loss of student edits or reviewed/approved maps
   */
  async deleteDocument(user, documentId, options = {}) {
    if (!user || !user.accessToken) {
      throw new Error('Authentication required');
    }
    const userClient = getUserSupabaseClient(user.accessToken);

    // 1. Fetch document to obtain its storage_path and verify ownership
    const doc = await DocumentModel.findById(userClient, documentId);
    if (!doc) {
      throw new Error('Document not found or access denied');
    }

    // 2. Safety Check: Protect reviewed/approved topic maps and student edits
    const subject = await TopicModel.findSubjectBySourceDocument(userClient, documentId);
    if (subject) {
      const isProtectedStatus = ['reviewed', 'approved'].includes(subject.status);
      const subjectTopics = await TopicModel.getTopicsBySubject(userClient, subject.id);
      const editedTopics = (subjectTopics || []).filter(t => t.extraction_metadata?.studentEdited === true);

      if ((isProtectedStatus || editedTopics.length > 0) && !options.confirmDiscard) {
        const reason = isProtectedStatus
          ? `Document is linked to an ${subject.status} topic map ("${subject.name}").`
          : `Document is linked to a topic map with ${editedTopics.length} student customization(s).`;
        const err = new Error(`${reason} Explicit confirmation (confirmDiscard=true) is required before deletion.`);
        err.code = 'CONFIRMATION_REQUIRED';
        err.status = 409;
        err.details = {
          subjectId: subject.id,
          subjectName: subject.name,
          subjectStatus: subject.status,
          isProtectedStatus,
          studentEditedCount: editedTopics.length,
          requiresConfirmation: true
        };
        throw err;
      }

      // Safe to delete subject (either confirmed by user or draft with no edits)
      try {
        await TopicModel.deleteSubject(userClient, subject.id);
      } catch (subErr) {
        console.warn('Warning deleting associated subject for document:', subErr.message);
      }
    }

    // 3. Remove file from Supabase Storage
    if (doc.storage_path) {
      const { error: storageErr } = await userClient.storage
        .from('study-materials')
        .remove([doc.storage_path]);

      if (storageErr) {
        console.warn('Storage deletion warning:', storageErr.message);
      }
    }

    // 4. Delete document chunks
    await DocumentChunkModel.deleteChunksByDocument(userClient, documentId);

    // 5. Delete database record
    return await DocumentModel.deleteDocument(userClient, documentId);
  }
};
