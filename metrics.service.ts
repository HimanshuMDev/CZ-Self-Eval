import { createLogger } from '../common/utils/logger.js';
import { historyService } from './history.service.js';
import {
  type SimulationResult,
  type EvalMetricsSummary,
  type AgentCoverageMetric
} from './types.js';

const logger = createLogger('MetricsService');

export class MetricsService {

  /**
   * Compute full metrics summary from all historical simulation results.
   * This powers the dashboard coverage matrix and regression view.
   */
  async getSummary(): Promise<EvalMetricsSummary> {
    const history = await historyService.getHistory();

    if (history.length === 0) {
      return this.emptyMetrics();
    }

    const totalRuns       = history.length;
    const passed          = history.filter(r => r.success).length;
    const overallPassRate = Math.round((passed / (totalRuns || 1)) * 100);
    const overallAvgScore = Math.round(
      history.reduce((sum, r) => sum + r.score, 0) / (totalRuns || 1)
    );

    // ── Per-agent coverage ──────────────────────────────────────────────────
    const agentMap: Record<string, { scores: number[]; times: number[]; passed: number }> = {};

    for (const result of history) {
      const agentsUsed = result.deterministicChecks?.agentTypesUsed ?? [];

      // If no agent info, fall back to goal tags
      const tags    = result.goal.tags ?? [];
      const buckets = agentsUsed.length > 0
        ? agentsUsed
        : tags.filter(t => ['discovery', 'session', 'payment', 'support', 'faq'].includes(t));

      for (const agent of buckets) {
        if (!agentMap[agent]) agentMap[agent] = { scores: [], times: [], passed: 0 };
        agentMap[agent].scores.push(result.score);
        agentMap[agent].times.push(result.deterministicChecks?.avgResponseTimeMs ?? 0);
        if (result.success) agentMap[agent].passed++;
      }
    }

    const agentCoverage: AgentCoverageMetric[] = Object.entries(agentMap).map(([agentType, data]) => ({
      agentType,
      totalScenarios:    data.scores.length,
      passed:            data.passed,
      failed:            data.scores.length - data.passed,
      avgScore:          Math.round(data.scores.reduce((a, b) => a + b, 0) / (data.scores.length || 1)),
      avgResponseTimeMs: Math.round(data.times.reduce((a, b) => a + b, 0) / (data.times.length || 1))
    }));

    // ── Tag coverage ────────────────────────────────────────────────────────
    const tagMap: Record<string, { total: number; passed: number; scores: number[] }> = {};

    for (const result of history) {
      for (const tag of result.goal.tags ?? []) {
        if (!tagMap[tag]) tagMap[tag] = { total: 0, passed: 0, scores: [] };
        tagMap[tag].total++;
        tagMap[tag].scores.push(result.score);
        if (result.success) tagMap[tag].passed++;
      }
    }

    const tagCoverage: Record<string, { total: number; passed: number; avgScore: number }> = {};
    for (const [tag, data] of Object.entries(tagMap)) {
      tagCoverage[tag] = {
        total:    data.total,
        passed:   data.passed,
        avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / (data.scores.length || 1))
      };
    }

    // ── Regression alerts count ─────────────────────────────────────────────
    const regressionAlerts = history.filter(r => r.regressionAlert?.triggered).length;

    // ── Slowest scenarios ───────────────────────────────────────────────────
    const slowestScenarios = [...history]
      .filter(r => (r.deterministicChecks?.avgResponseTimeMs ?? 0) > 0)
      .sort((a, b) =>
        (b.deterministicChecks?.avgResponseTimeMs ?? 0) -
        (a.deterministicChecks?.avgResponseTimeMs ?? 0)
      )
      .slice(0, 5)
      .map(r => ({
        scenarioId:        r.goal.id,
        avgResponseTimeMs: r.deterministicChecks?.avgResponseTimeMs ?? 0
      }));

    // ── Worst scoring scenarios ─────────────────────────────────────────────
    const worstScenarios = [...history]
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(r => ({
        scenarioId: r.goal.id,
        score:      r.score,
        name:       r.persona.name
      }));

    logger.info({ totalRuns, overallPassRate, overallAvgScore }, '[MetricsService] Summary computed');

    return {
      generatedAt:      new Date().toISOString(),
      totalRuns,
      overallPassRate,
      overallAvgScore,
      agentCoverage,
      tagCoverage,
      regressionAlerts,
      slowestScenarios,
      worstScenarios
    };
  }

  /**
   * Get pass rate trend over last N runs for a specific scenario / tag.
   */
  async getTrend(goalId: string, lastN = 10): Promise<{ runTimestamp: string; score: number; success: boolean }[]> {
    const history = await historyService.getHistory();
    return history
      .filter(r => r.goal.id === goalId)
      .slice(0, lastN)
      .reverse() // oldest first for chart display
      .map(r => ({
        runTimestamp: r.runTimestamp ?? r.simulationId,
        score:        r.score,
        success:      r.success
      }));
  }

  /**
   * Get all must-pass scenarios and their current status.
   */
  async getMustPassStatus(): Promise<{
    goalId: string;
    name: string;
    lastScore: number;
    threshold: number;
    passing: boolean;
  }[]> {
    const history = await historyService.getHistory();
    const seen    = new Map<string, SimulationResult>();

    // Get most recent result per goal
    for (const result of history) {
      if (!seen.has(result.goal.id)) seen.set(result.goal.id, result);
    }

    return [...seen.values()]
      .filter(r => r.goal.mustPass)
      .map(r => ({
        goalId:    r.goal.id,
        name:      r.persona.name,
        lastScore: r.score,
        threshold: r.goal.mustPassMinScore ?? 70,
        passing:   r.score >= (r.goal.mustPassMinScore ?? 70)
      }));
  }

  private emptyMetrics(): EvalMetricsSummary {
    return {
      generatedAt:      new Date().toISOString(),
      totalRuns:        0,
      overallPassRate:  0,
      overallAvgScore:  0,
      agentCoverage:    [],
      tagCoverage:      {},
      regressionAlerts: 0,
      slowestScenarios: [],
      worstScenarios:   []
    };
  }
}

export const metricsService = new MetricsService();
