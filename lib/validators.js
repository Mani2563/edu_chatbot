import { z } from 'zod';

export const DocumentTypeSchema = z.enum(['syllabus', 'notes', 'textbook', 'past_paper']);

export const DocumentUploadSchema = z.object({
  filename: z.string().min(1).max(255).refine(name => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ['pdf', 'docx', 'txt'].includes(ext);
  }, { message: 'Only .pdf, .docx, and .txt files are supported' }),
  documentType: DocumentTypeSchema,
  fileBase64: z.string().min(1, 'File content cannot be empty'),
  mimeType: z.string().optional()
});

export const DocumentDeleteSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required')
});

