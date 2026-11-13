/**
 * Model layer for public.subjects and public.topics
 * Directly queries Supabase PostgreSQL via user-scoped client enforcing Row Level Security (RLS)
 * Local memory fallback strictly removed per architectural requirements
 */
export const TopicModel = {
  /**
   * Find subject by source document ID
   */
  async findSubjectBySourceDocument(userClient, sourceDocumentId) {
    const { data, error } = await userClient
      .from('subjects')
      .select('*')
      .eq('source_document_id', sourceDocumentId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding subject by source_document_id:', error.message);
      throw new Error(`Database error querying subjects: ${error.message}`);
    }
    return data || null;
  },

  /**
   * Find subject by ID
   */
  async findSubjectById(userClient, subjectId) {
    const { data, error } = await userClient
      .from('subjects')
      .select('*')
      .eq('id', subjectId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding subject by id:', error.message);
      throw new Error(`Database error querying subject: ${error.message}`);
    }
    return data || null;
  },

  /**
   * Create subject record
   */
  async createSubject(userClient, data) {
    const record = {
      id: data.id,
      user_id: data.userId,
      source_document_id: data.sourceDocumentId || null,
      name: data.name,
      description: data.description || null,
      status: data.status || 'draft',
      fingerprint: data.fingerprint || null,
      metadata: data.metadata || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: created, error } = await userClient
      .from('subjects')
      .insert([record])
      .select()
      .single();

    if (error) {
      console.error('Error creating subject record:', error.message);
      throw new Error(`Failed to create subject in database: ${error.message}`);
    }
    return created;
  },

  /**
   * Update subject record (e.g. status transition from draft -> reviewed -> approved)
   */
  async updateSubject(userClient, subjectId, updates) {
    const payload = {
      updated_at: new Date().toISOString()
    };

    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.fingerprint !== undefined) payload.fingerprint = updates.fingerprint;
    if (updates.metadata !== undefined) payload.metadata = updates.metadata;

    const { data, error } = await userClient
      .from('subjects')
      .update(payload)
      .eq('id', subjectId)
      .select()
      .single();

    if (error) {
      console.error('Error updating subject:', error.message);
      throw new Error(`Failed to update subject: ${error.message}`);
    }
    return data;
  },

  /**
   * List all subjects for the authenticated user
   */
  async listSubjects(userClient) {
    const { data, error } = await userClient
      .from('subjects')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listing subjects:', error.message);
      throw new Error(`Failed to list subjects from database: ${error.message}`);
    }
    return data || [];
  },

  /**
   * Delete subject
   */
  async deleteSubject(userClient, subjectId) {
    const { data, error } = await userClient
      .from('subjects')
      .delete()
      .eq('id', subjectId)
      .select();

    if (error) {
      console.error('Error deleting subject:', error.message);
      throw new Error(`Failed to delete subject from database: ${error.message}`);
    }
    return data && data.length > 0;
  },

  /**
   * Batch insert topics
   */
  async insertTopics(userClient, topics) {
    if (!topics || topics.length === 0) return [];

    const { data, error } = await userClient
      .from('topics')
      .insert(topics)
      .select();

    if (error) {
      console.error('Error inserting topics in database:', error.message);
      throw new Error(`Database error saving topics: ${error.message}`);
    }
    return data || [];
  },

  /**
   * Get all topics for a subject ordered by display_order
   */
  async getTopicsBySubject(userClient, subjectId) {
    const { data, error } = await userClient
      .from('topics')
      .select('*')
      .eq('subject_id', subjectId)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching topics by subject:', error.message);
      throw new Error(`Failed to retrieve topics from database: ${error.message}`);
    }
    return data || [];
  },

  /**
   * Find topic by ID
   */
  async findTopicById(userClient, topicId) {
    const { data, error } = await userClient
      .from('topics')
      .select('*')
      .eq('id', topicId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding topic by id:', error.message);
      throw new Error(`Database error querying topic: ${error.message}`);
    }
    return data || null;
  },

  /**
   * Update topic
   */
  async updateTopic(userClient, topicId, updates) {
    const payload = {
      updated_at: new Date().toISOString()
    };

    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.description !== undefined) payload.description = updates.description;
    if (updates.displayOrder !== undefined) payload.display_order = updates.displayOrder;
    if (updates.extractionMetadata !== undefined) payload.extraction_metadata = updates.extractionMetadata;

    const { data, error } = await userClient
      .from('topics')
      .update(payload)
      .eq('id', topicId)
      .select()
      .single();

    if (error) {
      console.error('Error updating topic:', error.message);
      throw new Error(`Failed to update topic in database: ${error.message}`);
    }
    return data;
  },

  /**
   * Delete single topic (cascades to children)
   */
  async deleteTopic(userClient, topicId) {
    const { data, error } = await userClient
      .from('topics')
      .delete()
      .eq('id', topicId)
      .select();

    if (error) {
      console.error('Error deleting topic:', error.message);
      throw new Error(`Failed to delete topic from database: ${error.message}`);
    }
    return data && data.length > 0;
  },

  /**
   * Delete all topics belonging to a subject
   */
  async deleteTopicsBySubject(userClient, subjectId) {
    const { error } = await userClient
      .from('topics')
      .delete()
      .eq('subject_id', subjectId);

    if (error) {
      console.error('Error clearing subject topics:', error.message);
      throw new Error(`Failed to clear existing topics: ${error.message}`);
    }
    return true;
  },

  /**
   * Save complete topic tree atomically in a single PostgreSQL transaction via RPC
   * Supports 9-parameter signature (Migration 004) with graceful backward compatibility for 003
   */
  async saveTopicTreeViaRpc(userClient, params) {
    const { data, error } = await userClient.rpc('save_topic_tree', {
      p_source_document_id: params.sourceDocumentId,
      p_subject_id: params.subjectId || null,
      p_name: params.name,
      p_description: params.description || null,
      p_fingerprint: params.fingerprint || null,
      p_metadata: params.metadata || {},
      p_topics_data: params.topicsData || [],
      p_force_reextract: Boolean(params.forceReextract),
      p_confirm_discard_edits: Boolean(params.confirmDiscardEdits)
    });

    if (error) {
      if (error.code === 'PGRST202' && error.message?.includes('p_confirm_discard_edits')) {
        // Fallback to 8-param RPC if migration 004 is pending execution
        const fallback = await userClient.rpc('save_topic_tree', {
          p_source_document_id: params.sourceDocumentId,
          p_subject_id: params.subjectId || null,
          p_name: params.name,
          p_description: params.description || null,
          p_fingerprint: params.fingerprint || null,
          p_metadata: params.metadata || {},
          p_topics_data: params.topicsData || [],
          p_force_reextract: Boolean(params.forceReextract)
        });
        if (fallback.error) return { success: false, error: fallback.error };
        return { success: true, ...fallback.data };
      }
      return { success: false, error };
    }
    return { success: true, ...data };
  }
};

