import crypto from 'crypto';

/**
 * RevisionPlanModel: In-memory store and data access for Phase 7 Revision Plans
 * Strictly scopes plans to authenticated student and subject.
 * Clearly reports data source provenance (in_memory) to avoid false persistence claims.
 */

const memoryStore = {
  plans: new Map() // key: `${userId}:${subjectId}` -> plan object
};

export const RevisionPlanModel = {
  /**
   * Save or update revision plan in memory
   */
  async savePlan(userId, subjectId, planData) {
    if (!userId || !subjectId) {
      throw new Error('User ID and Subject ID are required');
    }

    const planId = planData.id || crypto.randomUUID();
    const record = {
      ...planData,
      id: planId,
      userId,
      subjectId,
      dataSource: 'in_memory',
      dataSourceNote: 'Revision plan stored in-memory for current session (Development mode). Remote database migration not executed.',
      updatedAt: new Date().toISOString()
    };

    memoryStore.plans.set(`${userId}:${subjectId}`, record);
    return record;
  },

  /**
   * Fetch active revision plan for a student and subject
   */
  async getPlanBySubject(userId, subjectId) {
    if (!userId || !subjectId) {
      throw new Error('User ID and Subject ID are required');
    }

    return memoryStore.plans.get(`${userId}:${subjectId}`) || null;
  },

  /**
   * Fetch revision plan by plan ID
   */
  async getPlanById(userId, planId) {
    for (const plan of memoryStore.plans.values()) {
      if (plan.id === planId && plan.userId === userId) {
        return plan;
      }
    }
    return null;
  },

  /**
   * Mark a revision task as completed or pending
   */
  async updateTaskCompletion(userId, planId, taskId, isCompleted) {
    const plan = await this.getPlanById(userId, planId);
    if (!plan) {
      throw new Error('Revision plan not found or access denied');
    }

    let foundTask = null;
    let totalTasks = 0;
    let completedTasks = 0;

    for (const day of plan.schedule) {
      for (const task of day.tasks) {
        totalTasks++;
        if (task.id === taskId) {
          task.isCompleted = Boolean(isCompleted);
          task.completedAt = isCompleted ? new Date().toISOString() : null;
          foundTask = task;
        }
        if (task.isCompleted) {
          completedTasks++;
        }
      }
    }

    if (!foundTask) {
      throw new Error(`Task with ID ${taskId} not found in revision plan`);
    }

    plan.completedTaskCount = completedTasks;
    plan.totalTaskCount = totalTasks;
    plan.progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    plan.updatedAt = new Date().toISOString();

    memoryStore.plans.set(`${userId}:${plan.subjectId}`, plan);

    return {
      success: true,
      plan,
      updatedTask: foundTask
    };
  },

  /**
   * Clear in-memory plan (testing utility)
   */
  clear() {
    memoryStore.plans.clear();
  }
};

