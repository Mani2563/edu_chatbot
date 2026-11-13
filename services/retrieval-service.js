import { getUserSupabaseClient } from '../lib/supabase.js';
import { DocumentChunkModel } from '../models/document-chunk-model.js';
import { BM25Engine } from '../lib/retriever.js';

export const RetrievalService = {
  /**
   * Retrieves relevant evidence chunks for an authenticated student using Okapi BM25
   */
  async retrieveEvidence(user, query, options = {}) {
    if (!user || !user.accessToken) {
      throw new Error('Authentication required for retrieval');
    }

    const { documentIds = [], topK = 5, threshold = 0.05 } = options;
    const cleanQuery = (query || '').trim();

    if (!cleanQuery) {
      return {
        success: true,
        query: '',
        hasEvidence: false,
        message: 'Query is empty',
        results: []
      };
    }

    const userClient = getUserSupabaseClient(user.accessToken);

    // 1. Fetch chunks belonging strictly to the user (and matching documentIds if provided)
    const userChunks = await DocumentChunkModel.getChunksByUser(userClient, user.id, documentIds);

    if (!userChunks || userChunks.length === 0) {
      return {
        success: true,
        query: cleanQuery,
        hasEvidence: false,
        message: 'No study materials uploaded or no chunks available for this selection',
        results: []
      };
    }

    // 2. Initialize deterministic Okapi BM25 Engine
    const engine = new BM25Engine(userChunks, {
      threshold,
      k1: 1.5,
      b: 0.75
    });

    // 3. Execute lexical ranking
    const searchResult = engine.search(cleanQuery, topK);

    if (!searchResult.hasEvidence) {
      return {
        success: true,
        query: cleanQuery,
        hasEvidence: false,
        message: 'Not covered in your uploaded study material.',
        results: []
      };
    }

    return {
      success: true,
      query: cleanQuery,
      hasEvidence: true,
      totalMatched: searchResult.totalMatched,
      results: searchResult.results
    };
  }
};

