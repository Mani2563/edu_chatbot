import { GapAnalysisModel } from '../models/gap-analysis-model.js';
import { getUserSupabaseClient, getSupabaseAdmin } from '../lib/supabase.js';

/**
 * Default classification thresholds and safeguards
 */
export const DEFAULT_THRESHOLDS = {
  WEAK_CEILING: 50.0,       // Below 50% is Weak
  MEDIUM_CEILING: 80.0,     // 50% to below 80% is Medium
  STRONG_FLOOR: 80.0,       // 80% or above is Strong
  MIN_QUESTIONS: 2          // Minimum questions required for confident classification
};

/**
 * GapAnalysisService: Core diagnostic intelligence engine
 * Analyzes completed quiz performance to identify what a student does not know.
 * Grounded in authentic evaluated quiz answers and source citations.
 */
export const GapAnalysisService = {
  /**
   * Run comprehensive gap analysis for a student and subject
   */
  async generateGapAnalysis(user, options = {}) {
    if (!user || !user.id) {
      throw new Error('Authentication required: Valid student session missing');
    }

    const { subjectId, attemptId = null, thresholds = {} } = options;
    if (!subjectId) {
      throw new Error('Subject ID is required for gap analysis');
    }

    const userClient = user.accessToken ? getUserSupabaseClient(user.accessToken) : null;
    const admin = getSupabaseAdmin();
    const db = userClient || admin;

    // 1. Verify subject existence and enforce authenticated student ownership
    const subject = await GapAnalysisModel.getSubject(db, subjectId, user.id);
    if (!subject) {
      throw new Error('Subject not found or access denied');
    }

    // 2. Fetch full curriculum hierarchy for topic mapping
    const hierarchy = await GapAnalysisModel.getCurriculumHierarchy(db, subjectId);
    const { allTopics, topicMap, resolveChapter } = hierarchy;

    // 3. Retrieve all completed quiz attempts and evaluated reviews
    const attemptsData = await GapAnalysisModel.getCompletedAttemptsWithReviews(db, user.id, subjectId, { attemptId });
    const { attempts, dataSource } = attemptsData;

    // Merged thresholds
    const cfg = {
      weakCeiling: thresholds.weakCeiling ?? DEFAULT_THRESHOLDS.WEAK_CEILING,
      mediumCeiling: thresholds.mediumCeiling ?? DEFAULT_THRESHOLDS.MEDIUM_CEILING,
      strongFloor: thresholds.strongFloor ?? DEFAULT_THRESHOLDS.STRONG_FLOOR,
      minQuestions: thresholds.minQuestions ?? DEFAULT_THRESHOLDS.MIN_QUESTIONS
    };

    // If no completed attempts are available
    if (!attempts || attempts.length === 0) {
      return {
        success: true,
        subject: {
          id: subject.id,
          name: subject.name
        },
        overallDiagnosis: {
          overallAccuracy: 0,
          totalAssessedQuestions: 0,
          totalCorrect: 0,
          totalIncorrect: 0,
          weakTopicsCount: 0,
          mediumTopicsCount: 0,
          strongTopicsCount: 0,
          insufficientDataTopicsCount: 0,
          unassessedTopicsCount: allTopics.length,
          topicsRequiringAttention: [],
          strongestTopics: [],
          mostFrequentlyIncorrectConcepts: []
        },
        topicReports: [],
        unassessedTopics: allTopics.map(t => ({
          topicId: t.id,
          topicName: t.name,
          hierarchyLevel: t.hierarchy_level,
          chapterName: resolveChapter(t.id).chapterName
        })),
        attemptComparison: null,
        dataSource,
        dataSourceNote: dataSource === 'in_memory'
          ? 'Diagnosis reflects currently available in-memory attempt data. Persistent remote history requires Migration 006.'
          : 'Diagnosis generated from persistent Supabase database records.',
        assessedAt: new Date().toISOString()
      };
    }

    // 4. Group all assessed questions by topic across completed attempts
    const topicAggregations = new Map();
    let grandTotalQuestions = 0;
    let grandTotalCorrect = 0;
    let grandTotalIncorrect = 0;

    // Track per-attempt topic accuracies for comparison
    const perAttemptTopicMap = [];

    attempts.forEach(({ attempt, questions }) => {
      const attemptTopicStats = new Map();

      questions.forEach(q => {
        // Resolve target topic ID
        let resolvedTopicId = q.topicId || attempt.topic_id;
        if (!resolvedTopicId && q.sourceReference?.chunkId) {
          // Fallback match by chunk citation if topic_id is missing
          for (const t of allTopics) {
            if (t.source_chunk_id === q.sourceReference.chunkId) {
              resolvedTopicId = t.id;
              break;
            }
          }
        }

        // If still unmapped, fall back to chapter ID or general bucket
        const topicKey = resolvedTopicId || (attempt.chapter_id ? `chapter:${attempt.chapter_id}` : 'general');
        const topicNode = topicMap.get(resolvedTopicId);
        const topicName = topicNode ? topicNode.name : (attempt.chapter_id ? 'Chapter Assessment' : 'General Assessment');
        const { chapterId, chapterName } = resolveChapter(resolvedTopicId || attempt.chapter_id);

        if (!topicAggregations.has(topicKey)) {
          topicAggregations.set(topicKey, {
            topicId: resolvedTopicId || null,
            topicKey,
            topicName,
            chapterId,
            chapterName,
            hierarchyLevel: topicNode?.hierarchy_level || 'topic',
            totalQuestions: 0,
            correctAnswers: 0,
            incorrectAnswers: 0,
            difficultyDistribution: {
              easy: { total: 0, correct: 0, incorrect: 0 },
              medium: { total: 0, correct: 0, incorrect: 0 },
              hard: { total: 0, correct: 0, incorrect: 0 }
            },
            questionReferences: []
          });
        }

        const agg = topicAggregations.get(topicKey);
        const isCorrect = Boolean(q.isCorrect);
        const difficulty = (q.difficulty || 'medium').toLowerCase();

        agg.totalQuestions += 1;
        grandTotalQuestions += 1;

        if (isCorrect) {
          agg.correctAnswers += 1;
          grandTotalCorrect += 1;
        } else {
          agg.incorrectAnswers += 1;
          grandTotalIncorrect += 1;
        }

        if (agg.difficultyDistribution[difficulty]) {
          agg.difficultyDistribution[difficulty].total += 1;
          if (isCorrect) agg.difficultyDistribution[difficulty].correct += 1;
          else agg.difficultyDistribution[difficulty].incorrect += 1;
        }

        agg.questionReferences.push({
          questionId: q.questionId,
          questionText: q.questionText,
          difficulty,
          selectedOption: q.selectedOption,
          correctOption: q.correctOption,
          isCorrect,
          explanation: q.explanation,
          sourceReference: q.sourceReference,
          attemptId: attempt.id,
          attemptCompletedAt: attempt.completed_at || attempt.created_at
        });

        // Per-attempt tracking
        if (!attemptTopicStats.has(topicKey)) {
          attemptTopicStats.set(topicKey, { total: 0, correct: 0 });
        }
        const ats = attemptTopicStats.get(topicKey);
        ats.total += 1;
        if (isCorrect) ats.correct += 1;
      });

      perAttemptTopicMap.push({
        attemptId: attempt.id,
        completedAt: attempt.completed_at || attempt.created_at,
        score: attempt.score,
        totalQuestions: attempt.total_questions || questions.length,
        percentage: attempt.percentage !== undefined ? Number(attempt.percentage) : 0,
        topicStats: attemptTopicStats
      });
    });

    // 5. Build Topic Reports with Classification, Grounded Reasons, and Actionable Recommendations
    const assessedTopics = [];
    const assessedTopicIds = new Set();

    for (const agg of topicAggregations.values()) {
      if (agg.topicId) assessedTopicIds.add(agg.topicId);

      const total = agg.totalQuestions;
      const correct = agg.correctAnswers;
      const incorrect = agg.incorrectAnswers;
      const accuracy = total > 0 ? Number(((correct / total) * 100).toFixed(1)) : 0;

      let classification = 'insufficient_data';
      let confidence = 'insufficient';
      let reason = '';
      let recommendedAction = '';

      // Safeguard 1 & 5: Do not classify as Strong on 1 easy question; require sufficient evidence
      if (total < cfg.minQuestions) {
        if (total === 1 && agg.difficultyDistribution.easy.correct === 1) {
          classification = 'insufficient_data';
          confidence = 'insufficient';
          reason = `Student answered 1 easy question correctly (100.0% accuracy). Under diagnostic safeguards, a topic cannot be classified as Strong based on a single easy question alone.`;
          recommendedAction = `Take an additional 3–5 question quiz covering medium and hard concepts to establish verified diagnostic mastery.`;
        } else if (accuracy >= cfg.strongFloor) {
          classification = 'insufficient_data';
          confidence = 'insufficient';
          reason = `Only 1 question attempted (${correct}/${total} correct). Insufficient data to verify consistent understanding across difficulty levels.`;
          recommendedAction = `Attempt additional practice questions to confirm consistent mastery.`;
        } else if (accuracy < cfg.weakCeiling) {
          classification = 'weak';
          confidence = 'low';
          reason = `Preliminary weak indicator based on 1 question (${correct}/${total} correct, ${accuracy}% accuracy). Missed on initial evaluation; further questions recommended to confirm full extent of gap.`;
          recommendedAction = `Priority revision required: Review foundational concepts from source material and solve guided problems.`;
        } else {
          classification = 'insufficient_data';
          confidence = 'insufficient';
          reason = `Only 1 question attempted (${correct}/${total} correct). Insufficient questions to establish a confident classification.`;
          recommendedAction = `Take a 3–5 question diagnostic quiz to establish confidence on this topic.`;
        }
      } else {
        // Confident multi-question classification (Safeguard 2, 3, 4)
        confidence = total >= 4 ? 'high' : 'medium';

        if (accuracy < cfg.weakCeiling) {
          classification = 'weak';
          const medHardFails = agg.difficultyDistribution.medium.incorrect + agg.difficultyDistribution.hard.incorrect;
          reason = `Student demonstrated significant knowledge gaps with ${correct}/${total} correct (${accuracy}% accuracy). ${
            medHardFails > 0 ? `Struggled particularly with medium/hard problems (${medHardFails} missed).` : 'Foundational concepts require remediation.'
          }`;
          recommendedAction = `Priority revision required: Re-read source materials for ${agg.topicName} and practice fundamental step-by-step exercises before retaking the diagnostic quiz.`;
        } else if (accuracy < cfg.mediumCeiling) {
          classification = 'medium';
          reason = `Student demonstrated partial understanding with ${correct}/${total} correct (${accuracy}% accuracy). Handled fundamental questions, but exhibited inconsistencies under challenging variations.`;
          recommendedAction = `Targeted practice required: Review the specific incorrect questions below, revise formula applications, and solve medium-difficulty problems.`;
        } else {
          classification = 'strong';
          reason = `Student demonstrated consistent understanding with ${correct}/${total} correct (${accuracy}% accuracy) across ${total} questions spanning varied difficulty.`;
          recommendedAction = `Mastery achieved: Maintain understanding with periodic spaced retrieval and move to dependent curriculum topics.`;
        }
      }

      assessedTopics.push({
        topicId: agg.topicId,
        topicName: agg.topicName,
        chapterId: agg.chapterId,
        chapterName: agg.chapterName,
        hierarchyLevel: agg.hierarchyLevel,
        classification,
        confidence,
        accuracyPercentage: accuracy,
        totalQuestions: total,
        correctAnswers: correct,
        incorrectAnswers: incorrect,
        difficultyDistribution: agg.difficultyDistribution,
        reason,
        recommendedAction,
        supportingQuestions: agg.questionReferences
      });
    }

    // Sort assessed topics by severity: Weak first, then Medium, then Insufficient Data, then Strong
    const priorityOrder = { weak: 1, medium: 2, insufficient_data: 3, strong: 4 };
    assessedTopics.sort((a, b) => {
      const pDiff = (priorityOrder[a.classification] || 5) - (priorityOrder[b.classification] || 5);
      if (pDiff !== 0) return pDiff;
      return a.accuracyPercentage - b.accuracyPercentage;
    });

    // 6. Overall Subject Diagnosis (Total Correct / Total Assessed Questions — NOT mean of percentages)
    const overallAccuracy = grandTotalQuestions > 0
      ? Number(((grandTotalCorrect / grandTotalQuestions) * 100).toFixed(1))
      : 0;

    const weakTopics = assessedTopics.filter(t => t.classification === 'weak');
    const mediumTopics = assessedTopics.filter(t => t.classification === 'medium');
    const strongTopics = assessedTopics.filter(t => t.classification === 'strong');
    const insufficientTopics = assessedTopics.filter(t => t.classification === 'insufficient_data');

    // Unassessed topics (Safeguard 6: never classify unassessed topics as weak)
    const unassessedTopics = allTopics
      .filter(t => !assessedTopicIds.has(t.id))
      .map(t => ({
        topicId: t.id,
        topicName: t.name,
        hierarchyLevel: t.hierarchy_level,
        chapterName: resolveChapter(t.id).chapterName
      }));

    // Most frequently incorrect concepts
    const mostFrequentlyIncorrect = [...assessedTopics]
      .filter(t => t.incorrectAnswers > 0)
      .sort((a, b) => b.incorrectAnswers - a.incorrectAnswers)
      .map(t => ({
        topicId: t.topicId,
        topicName: t.topicName,
        chapterName: t.chapterName,
        incorrectCount: t.incorrectAnswers,
        totalAttempted: t.totalQuestions,
        accuracyPercentage: t.accuracyPercentage
      }));

    // 7. Multiple-Attempt Progression & Comparison (Requirement 6)
    let attemptComparison = null;

    if (perAttemptTopicMap.length >= 2) {
      const latestAttempt = perAttemptTopicMap[perAttemptTopicMap.length - 1];
      const previousAttempt = perAttemptTopicMap[perAttemptTopicMap.length - 2];

      const prevAccuracy = previousAttempt.percentage;
      const latestAccuracy = latestAttempt.percentage;
      const improvement = Number((latestAccuracy - prevAccuracy).toFixed(1));

      let trend = 'steady';
      if (improvement > 0) trend = 'improved';
      else if (improvement < 0) trend = 'declined';

      // Compare per-topic accuracy between previous and latest attempt
      const topicComparisons = [];
      const topicsImproved = [];
      const topicsDeclined = [];
      const topicsSteady = [];
      const topicsInsufficientComparisonData = [];

      assessedTopics.forEach(top => {
        const key = top.topicId || top.topicName;
        const prevStats = previousAttempt.topicStats.get(key);
        const latestStats = latestAttempt.topicStats.get(key);

        if (prevStats && latestStats) {
          const prevTopAcc = Number(((prevStats.correct / prevStats.total) * 100).toFixed(1));
          const latestTopAcc = Number(((latestStats.correct / latestStats.total) * 100).toFixed(1));
          const change = Number((latestTopAcc - prevTopAcc).toFixed(1));

          let topStatus = 'steady';
          if (change > 0) {
            topStatus = 'improved';
            topicsImproved.push(top.topicName);
          } else if (change < 0) {
            topStatus = 'declined';
            topicsDeclined.push(top.topicName);
          } else {
            topicsSteady.push(top.topicName);
          }

          topicComparisons.push({
            topicId: top.topicId,
            topicName: top.topicName,
            chapterName: top.chapterName,
            previousAccuracy: prevTopAcc,
            latestAccuracy: latestTopAcc,
            change,
            status: topStatus
          });
        } else {
          topicsInsufficientComparisonData.push(top.topicName);
        }
      });

      attemptComparison = {
        totalCompletedAttempts: perAttemptTopicMap.length,
        previousAttemptId: previousAttempt.attemptId,
        previousAccuracy: prevAccuracy,
        latestAttemptId: latestAttempt.attemptId,
        latestAccuracy: latestAccuracy,
        improvement,
        trend,
        topicComparisons,
        topicsImproved,
        topicsDeclined,
        topicsSteady,
        topicsInsufficientComparisonData
      };
    } else if (perAttemptTopicMap.length === 1) {
      attemptComparison = {
        totalCompletedAttempts: 1,
        latestAttemptId: perAttemptTopicMap[0].attemptId,
        latestAccuracy: perAttemptTopicMap[0].percentage,
        trend: 'insufficient_comparison_data',
        message: 'Initial diagnostic baseline established. Complete additional quiz attempts to track performance progression.'
      };
    }

    return {
      success: true,
      subject: {
        id: subject.id,
        name: subject.name
      },
      overallDiagnosis: {
        overallAccuracy,
        totalAssessedQuestions: grandTotalQuestions,
        totalCorrect: grandTotalCorrect,
        totalIncorrect: grandTotalIncorrect,
        weakTopicsCount: weakTopics.length,
        mediumTopicsCount: mediumTopics.length,
        strongTopicsCount: strongTopics.length,
        insufficientDataTopicsCount: insufficientTopics.length,
        unassessedTopicsCount: unassessedTopics.length,
        topicsRequiringAttention: [...weakTopics, ...mediumTopics].map(t => ({
          topicId: t.topicId,
          topicName: t.topicName,
          chapterName: t.chapterName,
          classification: t.classification,
          accuracyPercentage: t.accuracyPercentage,
          totalQuestions: t.totalQuestions,
          recommendedAction: t.recommendedAction
        })),
        strongestTopics: strongTopics.map(t => ({
          topicId: t.topicId,
          topicName: t.topicName,
          chapterName: t.chapterName,
          accuracyPercentage: t.accuracyPercentage,
          totalQuestions: t.totalQuestions
        })),
        mostFrequentlyIncorrectConcepts: mostFrequentlyIncorrect
      },
      topicReports: assessedTopics,
      unassessedTopics,
      attemptComparison,
      dataSource,
      dataSourceNote: dataSource === 'in_memory'
        ? 'Diagnosis reflects currently available in-memory attempt data. Persistent remote history requires Migration 006.'
        : 'Diagnosis generated from persistent Supabase database records.',
      assessedAt: new Date().toISOString()
    };
  }
};

