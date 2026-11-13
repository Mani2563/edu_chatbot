import { chunkDocument } from '../lib/chunking.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';

export const ChunkService = {
  /**
   * Chunks extracted document pages and persists them with RLS ownership
   */
  async createAndStoreChunks(userClient, user, documentId, pages, fileName) {
    if (!user || !user.id) throw new Error('User context required for chunk storage');
    if (!documentId) throw new Error('documentId required for chunk storage');
    if (!pages || pages.length === 0) return { chunkCount: 0, chunks: [] };

    // 1. Generate semantic chunks
    const chunks = chunkDocument(pages, {
      documentId,
      userId: user.id,
      fileName,
      targetSize: 800,
      minSize: 150,
      overlapSize: 120
    });

    if (chunks.length === 0) return { chunkCount: 0, chunks: [] };

    // 2. Persist chunks in database (or local store)
    const storedChunks = await DocumentChunkModel.insertChunks(userClient, chunks);

    return {
      chunkCount: chunks.length,
      chunks: storedChunks
    };
  }
};

