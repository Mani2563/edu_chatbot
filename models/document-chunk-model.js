/**
 * Model layer for public.document_chunks
 * Executes queries through user-scoped Supabase client respecting Row Level Security (RLS)
 */

// Memory fallback store for local development before migration is executed in Supabase SQL Editor
const memoryChunks = new Map(); // userId -> Map(chunkId -> chunk)

export const DocumentChunkModel = {
  /**
   * Save array of chunks for a document
   */
  async insertChunks(userClient, chunks) {
    if (!chunks || chunks.length === 0) return [];

    const { data, error } = await userClient
      .from('document_chunks')
      .insert(chunks)
      .select();

    if (error) {
      if (error.code === '42P01' || error.message?.includes('Could not find the table')) {
        console.warn('Notice: public.document_chunks table pending migration in Supabase. Storing in local cache.');
        const userId = chunks[0].user_id;
        if (!memoryChunks.has(userId)) memoryChunks.set(userId, new Map());
        const userStore = memoryChunks.get(userId);
        for (const c of chunks) {
          userStore.set(c.id, { ...c, created_at: new Date().toISOString() });
        }
        return chunks;
      }
      console.error('Error inserting document chunks:', error.message);
      throw new Error(`Failed to save document chunks: ${error.message}`);
    }

    return data || chunks;
  },

  /**
   * Get all chunks belonging to an authenticated user, optionally filtered by document IDs
   */
  async getChunksByUser(userClient, userId, documentIds = []) {
    let query = userClient
      .from('document_chunks')
      .select('id, document_id, user_id, chunk_index, content, page_number, section_title, metadata, created_at')
      .order('chunk_index', { ascending: true });

    if (documentIds && documentIds.length > 0) {
      query = query.in('document_id', documentIds);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01' || error.message?.includes('Could not find the table')) {
        const userStore = memoryChunks.get(userId);
        if (!userStore) return [];
        let all = Array.from(userStore.values());
        if (documentIds && documentIds.length > 0) {
          all = all.filter(c => documentIds.includes(c.document_id));
        }
        return all.sort((a, b) => a.chunk_index - b.chunk_index);
      }
      console.error('Error fetching document chunks:', error.message);
      throw new Error(`Failed to retrieve document chunks: ${error.message}`);
    }

    return data || [];
  },

  /**
   * Delete chunks for a document
   */
  async deleteChunksByDocument(userClient, documentId) {
    const { data, error } = await userClient
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId)
      .select();

    if (error) {
      if (error.code === '42P01' || error.message?.includes('Could not find the table')) {
        for (const userStore of memoryChunks.values()) {
          for (const [id, c] of userStore.entries()) {
            if (c.document_id === documentId) userStore.delete(id);
          }
        }
        return true;
      }
      console.error('Error deleting document chunks:', error.message);
      throw new Error(`Failed to delete document chunks: ${error.message}`);
    }

    return true;
  }
};

