/**
 * Model layer for public.documents
 * All operations execute through a user-scoped Supabase client enforcing Row Level Security (RLS)
 */
export const DocumentModel = {
  /**
   * Find document by unique storage_path
   */
  async findByStoragePath(userClient, storagePath) {
    const { data, error } = await userClient
      .from('documents')
      .select('*')
      .eq('storage_path', storagePath)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding document by storage_path:', error.message);
      throw new Error(`Database query error: ${error.message}`);
    }
    return data || null;
  },

  /**
   * Find document by ID
   */
  async findById(userClient, documentId) {
    const { data, error } = await userClient
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding document by id:', error.message);
      throw new Error(`Database query error: ${error.message}`);
    }
    return data || null;
  },

  /**
   * Insert new document record with pending/processing status
   */
  async createDocument(userClient, docData) {
    const record = {
      id: docData.id,
      user_id: docData.userId,
      file_name: docData.fileName,
      storage_path: docData.storagePath,
      file_type: docData.fileType,
      file_size: docData.fileSize,
      processing_status: docData.processingStatus || 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await userClient
      .from('documents')
      .insert([record])
      .select()
      .single();

    if (error) {
      console.error('Error creating document record:', error.message);
      throw new Error(`Failed to create document record: ${error.message}`);
    }
    return data;
  },

  /**
   * Update document processing status, extracted text, or error message
   */
  async updateStatus(userClient, documentId, updates) {
    const payload = {
      updated_at: new Date().toISOString()
    };

    if (updates.processingStatus !== undefined) payload.processing_status = updates.processingStatus;
    if (updates.extractedText !== undefined) payload.extracted_text = updates.extractedText;
    if (updates.errorMessage !== undefined) payload.error_message = updates.errorMessage;
    if (updates.fileSize !== undefined) payload.file_size = updates.fileSize;
    if (updates.fileType !== undefined) payload.file_type = updates.fileType;

    const { data, error } = await userClient
      .from('documents')
      .update(payload)
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      console.error('Error updating document record:', error.message);
      throw new Error(`Failed to update document: ${error.message}`);
    }
    return data;
  },

  /**
   * List user's documents (omits large extracted_text field for performance)
   */
  async listUserDocuments(userClient) {
    const { data, error } = await userClient
      .from('documents')
      .select('id, user_id, file_name, storage_path, file_type, file_size, processing_status, error_message, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listing user documents:', error.message);
      throw new Error(`Failed to list documents: ${error.message}`);
    }
    return data || [];
  },

  /**
   * Delete document by ID (RLS ensures user can only delete own document)
   */
  async deleteDocument(userClient, documentId) {
    const { data, error } = await userClient
      .from('documents')
      .delete()
      .eq('id', documentId)
      .select();

    if (error) {
      console.error('Error deleting document record:', error.message);
      throw new Error(`Failed to delete document: ${error.message}`);
    }
    return data && data.length > 0;
  }
};
