import { AgentType } from '../common/types/agent.types.js';

// ─── Persona & Goal ───────────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  description: string;
  behaviorRules: string[];
  emotionalState: 'happy' | 'neutral' | 'impatient' | 'angry' | 'confused' | 'annoyed';
  language: 'English' | 'Hindi' | 'Mixed' | 'Hinglish';
  primaryGoal?: SimulationGoal;
}

export type SupportedLanguage = 'English' | 'Hindi' | 'Hinglish';

export interface SimulationGoal {
  id: string;
  objective: string;
  successCondition: string;
  evidenceId?: string;   // Links to a real LangSmith trace ID for replay tests
  tags?: GoalTag[];      // Used for coverage matrix and filtering
  mustPass?: boolean;    // If true, score below mustPassMinScore triggers a regression alert
  mustPassMinScore?: number; // Default 70 if mustPass is true
  expectedAgentType?: AgentType; // Which agent MUST handle this (for routing verification)
  assertions?: Array<{ type: 'contains_text' | 'tool_call', value: string }>; // Programmatic assertions
}

export type GoalTag =
  | 'discovery'
  | 'session'
  | 'payment'
  | 'support'
  | 'faq'
  | 'safety'
  | 'routing'
  | 'context-memory'
  | 'hinglish'
  | 'registration'
  | 'booking-flow'
  | 'wallet'
  | 'rfid'
  | 'loyalty'
  | 'regression';

// ─── Deterministic Checks ─────────────────────────────────────────────────────

export interface DeterministicCheckResult {
  locationLoopDetected: boolean;     // Agent asked for location 3+ times
  safetyMisrouted: boolean;          // Fire/smoke/emergency not routed to Support
  agentHallucinatedName: boolean;    // Agent treated query text as user name
  stuckInRepetitionLoop: boolean;    // Same request pattern repeated 3+ times
  wrongAgentRouted: boolean;         // Agent type used ≠ expectedAgentType
  agentTypesUsed: string[];          // All agent types that appeared
  turnsTaken: number;
  avgResponseTimeMs: number;         // Average agent response time per turn
  slowTurns: number;                 // Turns that exceeded 6000ms
  penalties: string[];               // Human-readable list of applied penalties
}

// ─── Per-Turn Latency ─────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: 'tester' | 'agent';
  content: string;
  timestamp: Date;
  metadata?: {
    thought?: string;
    toolsUsed?: string[];
    agentType?: AgentType;
    responseTimeMs?: number;   // How long the agent took to reply (agent turns only)
    satisfiedWithResponse?: boolean; // TesterAgent's assessment of agent reply
    terminationReason?: string; // If done is true, why did it terminate?
    agentResponseAnalysis?: string; // TesterAgent's interpretation of the CZ agent's reply
  };
}

// ─── Simulation Result ────────────────────────────────────────────────────────

export interface SimulationResult {
  simulationId: string;
  runTimestamp: string;        // ISO string — when this run happened
  persona: Persona;
  goal: SimulationGoal;
  transcript: ConversationTurn[];
  success: boolean;
  score: number;               // 0–100 final score (after deterministic overrides)
  llmScore: number;            // Raw LLM judge score before overrides
  judgeReasoning: string;
  deterministicChecks: DeterministicCheckResult;
  totalTurns: number;
  tokensUsed: number;
  regressionAlert?: RegressionAlert; // Set if mustPass scenario dropped below threshold
  comments?: Array<{ timestamp: string; text: string }>;
  reportMarkdown?: string;     // Generated detailed markdown report
  languageOverride?: SupportedLanguage;
  batchId?: string;
  agentVersion?: string;       // The system version used to generate this result
  stalled?: boolean;           // Hit max turns without completion
}

export interface RegressionAlert {
  triggered: boolean;
  previousScore: number;
  currentScore: number;
  drop: number;
  message: string;
}

// ─── Metrics & Coverage ───────────────────────────────────────────────────────

export interface AgentCoverageMetric {
  agentType: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  avgScore: number;
  avgResponseTimeMs: number;
}

export interface EvalMetricsSummary {
  generatedAt: string;
  totalRuns: number;
  overallPassRate: number;       // % of scenarios with success=true
  overallAvgScore: number;
  agentCoverage: AgentCoverageMetric[];
  tagCoverage: Record<string, { total: number; passed: number; avgScore: number }>;
  regressionAlerts: number;      // Count of mustPass scenarios that dropped
  slowestScenarios: { scenarioId: string; avgResponseTimeMs: number }[];
  worstScenarios: { scenarioId: string; score: number; name: string }[];
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type SimulationEventType = 'turn' | 'status' | 'result' | 'error' | 'metrics';

export interface SimulationEvent {
  type: SimulationEventType;
  payload: any;
  timestamp: Date;
}
