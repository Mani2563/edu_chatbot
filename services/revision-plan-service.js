import crypto from 'crypto';
import { GapAnalysisService } from './gap-analysis-service.js';
import { RevisionPlanModel } from '../models/revision-plan-model.js';

/**
 * RevisionPlanService: Intelligent, grounded revision schedule generator (Phase 7)
 * Prioritizes topics strictly based on authentic Phase 6 diagnostic results.
 * Respects available study days and daily study hours.
 */

export const RevisionPlanService = {
  /**
   * Generate an authentic, prioritized day-wise revision plan
   */
  async generatePlan(user, { subjectId, availableDays = 5, hoursPerDay = 2 }) {
    if (!user || !user.id) {
      throw new Error('Authentication required: Valid student session missing');
    }
    if (!subjectId) {
      throw new Error('Subject ID is required to generate a revision plan');
    }

    const days = parseInt(availableDays, 10);
    const hours = parseFloat(hoursPerDay);

    if (isNaN(days) || days < 1 || days > 60) {
      throw new Error('Available study days must be an integer between 1 and 60');
    }
    if (isNaN(hours) || hours <= 0 || hours > 16) {
      throw new Error('Study hours per day must be a positive number between 0.5 and 16');
    }

    // 1. Fetch authentic Phase 6 diagnostic gap analysis for this subject
    const gapReport = await GapAnalysisService.generateGapAnalysis(user, { subjectId });
    if (!gapReport || !gapReport.success) {
      throw new Error('Could not retrieve gap analysis diagnosis for subject');
    }

    const {
      subjectName,
      overallDiagnosis,
      topicReports = [],
      unassessedTopics = [],
      dataSource
    } = gapReport;

    // 2. Classify and prioritize topics based on authentic Phase 6 diagnosis
    // Priority order:
    // 1. Weak topics (Highest Priority - Core Revision)
    // 2. Medium topics (Second Priority - Targeted Practice)
    // 3. Insufficient Data topics (Diagnostic Assessment Priority)
    // 4. Strong topics (Lower Priority - Maintenance & Advanced Practice)
    // 5. Unassessed topics (Optional if spare time remains)

    const weakTasks = [];
    const mediumTasks = [];
    const insufficientTasks = [];
    const strongTasks = [];

    for (const report of topicReports) {
      const accuracyVal = report.accuracyPercentage ?? (report.totalQuestions > 0 ? Math.round((report.correctAnswers / report.totalQuestions) * 100) : 0);
      const taskBase = {
        topicId: report.topicId,
        topicName: report.topicName,
        chapterId: report.chapterId || null,
        chapterName: report.chapterName || 'General Curriculum',
        accuracy: accuracyVal,
        totalQuestions: report.totalQuestions,
        correctAnswers: report.correctAnswers,
        incorrectAnswers: report.incorrectAnswers,
        difficultyDistribution: report.difficultyDistribution,
        sourceReferences: report.sourceReferences || [],
        isCompleted: false,
        completedAt: null
      };

      if (report.classification === 'weak') {
        weakTasks.push({
          ...taskBase,
          priority: 'high',
          priorityLabel: 'High Priority (Weak Topic)',
          priorityOrder: 1,
          defaultEstimatedHours: Math.min(hours, 1.5),
          reason: report.reason || `Demonstrated significant knowledge gaps with ${accuracyVal}% accuracy (${report.correctAnswers}/${report.totalQuestions} correct).`,
          recommendedActivity: report.recommendedAction || `Priority revision: Review textbook source materials, study foundational definitions, and practice step-by-step problems before retaking the diagnostic quiz.`
        });
      } else if (report.classification === 'medium') {
        mediumTasks.push({
          ...taskBase,
          priority: 'medium',
          priorityLabel: 'Medium Priority (Practice Needed)',
          priorityOrder: 2,
          defaultEstimatedHours: Math.min(hours, 1.0),
          reason: report.reason || `Moderate understanding demonstrated (${accuracyVal}% accuracy, ${report.correctAnswers}/${report.totalQuestions} correct).`,
          recommendedActivity: report.recommendedAction || `Targeted practice: Review missed concepts and work through intermediate problems before retaking the quiz.`
        });
      } else if (report.classification === 'insufficient_data') {
        insufficientTasks.push({
          ...taskBase,
          priority: 'diagnostic',
          priorityLabel: 'Diagnostic Recommended (Insufficient Data)',
          priorityOrder: 3,
          defaultEstimatedHours: Math.min(hours, 0.75),
          reason: report.reason || `Only ${report.totalQuestions} question(s) assessed. Additional questions required to confidently identify knowledge gaps.`,
          recommendedActivity: report.recommendedAction || `Take a complete 5-question diagnostic quiz on ${report.topicName} to uncover learning gaps.`
        });
      } else if (report.classification === 'strong') {
        strongTasks.push({
          ...taskBase,
          priority: 'low',
          priorityLabel: 'Low Priority (Mastered Topic)',
          priorityOrder: 4,
          defaultEstimatedHours: Math.min(hours, 0.5),
          reason: report.reason || `Solid mastery demonstrated with ${accuracyVal}% accuracy (${report.correctAnswers}/${report.totalQuestions} correct).`,
          recommendedActivity: report.recommendedAction || `Quick maintenance recap and advanced challenge problems after higher-priority topics are completed.`
        });
      }
    }

    // Sort within categories by lowest accuracy first
    weakTasks.sort((a, b) => a.accuracy - b.accuracy);
    mediumTasks.sort((a, b) => a.accuracy - b.accuracy);

    // Combine prioritized queue
    const prioritizedQueue = [
      ...weakTasks,
      ...mediumTasks,
      ...insufficientTasks,
      ...strongTasks
    ];

    // If total assessed topics is low, add unassessed topics to fill student schedule
    if (prioritizedQueue.length < days && unassessedTopics.length > 0) {
      const needed = Math.min(days * 2 - prioritizedQueue.length, unassessedTopics.length);
      for (let i = 0; i < needed; i++) {
        const unassessed = unassessedTopics[i];
        prioritizedQueue.push({
          topicId: unassessed.topicId,
          topicName: unassessed.topicName,
          chapterName: unassessed.chapterName || 'General Curriculum',
          accuracy: null,
          totalQuestions: 0,
          correctAnswers: 0,
          incorrectAnswers: 0,
          difficultyDistribution: { easy: 0, medium: 0, hard: 0 },
          sourceReferences: [],
          isCompleted: false,
          completedAt: null,
          priority: 'unassessed',
          priorityLabel: 'Initial Assessment (Unassessed)',
          priorityOrder: 5,
          defaultEstimatedHours: Math.min(hours, 0.75),
          reason: `Topic has not yet been assessed through any diagnostic quiz.`,
          recommendedActivity: `Take an initial diagnostic quiz on this topic to assess baseline understanding.`
        });
      }
    }

    // 3. Allocate tasks into day-wise schedule
    const schedule = [];
    for (let d = 1; d <= days; d++) {
      schedule.push({
        dayNumber: d,
        title: `Day ${d}`,
        allocatedHours: 0,
        maxHours: hours,
        tasks: []
      });
    }

    let currentDayIndex = 0;

    for (const item of prioritizedQueue) {
      if (currentDayIndex >= days) {
        // If all days are filled to capacity, stop scheduling or place in final review day
        break;
      }

      let targetDay = schedule[currentDayIndex];
      const taskHours = item.defaultEstimatedHours;

      // Check if task fits in current day; if not, advance to next day unless it's empty
      if (targetDay.allocatedHours + taskHours > hours && targetDay.tasks.length > 0) {
        currentDayIndex++;
        if (currentDayIndex < days) {
          targetDay = schedule[currentDayIndex];
        } else {
          // Reached end of schedule
          break;
        }
      }

      const taskId = crypto.randomUUID();
      const task = {
        id: taskId,
        dayNumber: targetDay.dayNumber,
        topicId: item.topicId,
        topicName: item.topicName,
        chapterName: item.chapterName,
        priority: item.priority,
        priorityLabel: item.priorityLabel,
        priorityOrder: item.priorityOrder,
        estimatedHours: taskHours,
        reason: item.reason,
        recommendedActivity: item.recommendedActivity,
        accuracy: item.accuracy,
        totalQuestions: item.totalQuestions,
        correctAnswers: item.correctAnswers,
        incorrectAnswers: item.incorrectAnswers,
        sourceReferences: item.sourceReferences,
        isCompleted: false,
        completedAt: null
      };

      targetDay.tasks.push(task);
      targetDay.allocatedHours = Math.round((targetDay.allocatedHours + taskHours) * 10) / 10;
    }

    // Calculate total scheduled tasks and study hours
    let totalScheduledTasks = 0;
    let totalPlannedHours = 0;
    for (const day of schedule) {
      totalScheduledTasks += day.tasks.length;
      totalPlannedHours += day.allocatedHours;
    }

    // 4. Assemble the revision plan payload
    const plan = {
      id: crypto.randomUUID(),
      subjectId,
      subjectName,
      availableDays: days,
      hoursPerDay: hours,
      totalAvailableHours: Math.round(days * hours * 10) / 10,
      totalPlannedHours: Math.round(totalPlannedHours * 10) / 10,
      totalTaskCount: totalScheduledTasks,
      completedTaskCount: 0,
      progressPercentage: 0,
      diagnosticSummary: {
        overallAccuracy: overallDiagnosis.overallAccuracy,
        totalAssessedQuestions: overallDiagnosis.totalAssessedQuestions,
        weakCount: weakTasks.length,
        mediumCount: mediumTasks.length,
        insufficientCount: insufficientTasks.length,
        strongCount: strongTasks.length,
        unassessedCount: unassessedTopics.length
      },
      schedule,
      dataSource: dataSource || 'in_memory',
      createdAt: new Date().toISOString()
    };

    // Save in model store
    return await RevisionPlanModel.savePlan(user.id, subjectId, plan);
  },

  /**
   * Retrieve active revision plan
   */
  async getPlan(user, subjectId) {
    if (!user || !user.id) {
      throw new Error('Authentication required: Valid student session missing');
    }
    if (!subjectId) {
      throw new Error('Subject ID is required');
    }

    return await RevisionPlanModel.getPlanBySubject(user.id, subjectId);
  },

  /**
   * Mark task as completed or pending
   */
  async updateTaskStatus(user, { planId, taskId, isCompleted }) {
    if (!user || !user.id) {
      throw new Error('Authentication required: Valid student session missing');
    }
    if (!planId || !taskId) {
      throw new Error('Plan ID and Task ID are required');
    }

    return await RevisionPlanModel.updateTaskCompletion(user.id, planId, taskId, isCompleted);
  }
};
