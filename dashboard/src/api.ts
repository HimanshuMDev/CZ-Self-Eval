const API_BASE = 'https://api.aiagent.dev.chargecloud.net/api/arena';

export interface Persona {
  id: string;
  name: string;
  description: string;
}

export interface Goal {
  id: string;
  objective: string;
}

export const fetchPersonas = async () => {
  const res = await fetch(`${API_BASE}/personas`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.personas || []) as Persona[];
};

export const fetchGoals = async () => {
  const res = await fetch(`${API_BASE}/goals`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.goals || []) as Goal[];
};

export const fetchEvidence = async () => {
  const res = await fetch(`${API_BASE}/evidence`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.evidence || []) as { persona: Persona, goal: Goal }[];
};

export const fetchHistory = async () => {
  const res = await fetch(`${API_BASE}/history`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.history || []) as any[];
};

export const runSimulation = async (personaId: string, goalId: string, evidenceContext: string = '') => {
  const res = await fetch(`${API_BASE}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personaId, goalId, evidenceContext }),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return await res.json();
};

export const addComment = async (simulationId: string, text: string) => {
  const res = await fetch(`${API_BASE}/history/${simulationId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return await res.json();
};

export const saveReport = async (simulationId: string, reportMarkdown: string) => {
  const res = await fetch(`${API_BASE}/history/${simulationId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportMarkdown }),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return await res.json();
};

// --- Sandbox ---

export interface CustomScenario {
  id: string;
  title: string;
  description: string;
  scenarioContext: string;
  createdAt: string;
}

export const fetchSandboxScenarios = async (): Promise<CustomScenario[]> => {
  const res = await fetch(`${API_BASE}/sandbox`);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return await res.json();
};

export const createSandboxScenario = async (data: Omit<CustomScenario, 'id' | 'createdAt'>) => {
  const res = await fetch(`${API_BASE}/sandbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return await res.json();
};

export const deleteSandboxScenario = async (id: string) => {
  const res = await fetch(`${API_BASE}/sandbox/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return await res.json();
};

export const streamBatchSimulation = (
  onEvent: (type: string, payload: any) => void,
  onError: (err: any) => void
) => {
  const eventSource = new EventSource(`${API_BASE}/batch/stream`);

  const handleEvent = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent(e.type || 'message', data);
    } catch (err) {
      console.error('Failed to parse SSE event', err);
    }
  };

  eventSource.addEventListener('batch-progress', handleEvent);
  eventSource.addEventListener('batch-complete', handleEvent);
  eventSource.addEventListener('status', handleEvent);
  eventSource.addEventListener('turn', handleEvent);
  eventSource.addEventListener('result', handleEvent);
  eventSource.addEventListener('error', (e) => {
    handleEvent(e as MessageEvent);
    onError(e);
  });

  return eventSource;
};

// --- Chat Sessions ---

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  isButtonTap?: boolean;
  metadata?: {
    agentType?: string;
    responseTimeMs?: number;
    buttons?: Array<{ id: string; title: string; payload?: string }>;
    data?: Record<string, unknown>;
  };
  comment?: string;
  flag?: 'pass' | 'fail' | 'bug' | 'slow' | null;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  from: string;
  totalMessages: number;
  totalAgentMessages: number;
  avgResponseTimeMs: number;
  agentTypesUsed: string[];
  flags: { pass: number; fail: number; bug: number; slow: number };
  messages: ChatMessageRecord[];
  summary?: string;
}

export const saveChatSession = async (session: ChatSession) => {
  const res = await fetch(`${API_BASE}/chat-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json();
};

export const fetchChatSessions = async () => {
  const res = await fetch(`${API_BASE}/chat-sessions`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data.sessions || []) as Omit<ChatSession, 'messages'>[];
};

export const fetchChatSession = async (id: string) => {
  const res = await fetch(`${API_BASE}/chat-sessions/${id}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json() as ChatSession;
};

export const deleteChatSession = async (id: string) => {
  const res = await fetch(`${API_BASE}/chat-sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json();
};

// --- Local eval server (port 4001 via Vite proxy) ---

const LOCAL_API = '/api';

export interface EvalResultRecord {
  scenarioId: string;
  scenarioName: string;
  category: string;
  severity: string;
  pass: boolean;
  score: number;
  reason: string;
  detail?: string;
  response?: string;
  testMessage: string;
  runAt?: string;
  isFlaky?: boolean;
}

export const saveEvalResult = async (result: EvalResultRecord) => {
  const res = await fetch(`${LOCAL_API}/eval-results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json();
};

export const fetchEvalResults = async () => {
  const res = await fetch(`${LOCAL_API}/eval-results`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data.results || []) as EvalResultRecord[];
};

export interface MetricsData {
  healthScore: number;
  totalSessions: number;
  passRateByDay: { date: string; rate: number; total: number }[];
  sessionsByDay: { date: string; count: number }[];
  evalByCategory: { category: string; pass: number; fail: number; total: number }[];
  agentFailures: { agentType: string; count: number }[];
  topFailing: { name: string; failCount: number; lastStatus: string }[];
  flakyCount: number;
}

export const fetchMetrics = async (): Promise<MetricsData> => {
  const res = await fetch(`${LOCAL_API}/metrics`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json();
};

export const searchSessions = async (query: string) => {
  const res = await fetch(`${LOCAL_API}/sessions/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return (data.sessions || []) as Omit<ChatSession, 'messages'>[];
};

// ─── Question Bank (persisted in MongoDB) ─────────────────────────────────────

export interface QuestionBankItem {
  id: string;
  text: string;
  category: string;
  source: 'ai' | 'history' | 'custom';
  batchId?: string | null;
  createdAt: string;
}

export interface GenerateResult {
  ok: boolean;
  method: 'llm' | 'fallback';
  historyCount: number;
  generatedCount: number;
  savedCount: number;
  batchId: string;
  questions: QuestionBankItem[];
}

/** Fetch all saved questions from the bank */
export const fetchQuestionBank = async (): Promise<QuestionBankItem[]> => {
  const res = await fetch(`${LOCAL_API}/questions-bank`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.questions as QuestionBankItem[];
};

/** Preview: generate questions WITHOUT saving — for the selection dialog */
export const previewQuestionBank = async (count = 20): Promise<{
  ok: boolean; method: string; historyCount: number;
  questions: { text: string; category: string }[];
}> => {
  const res = await fetch(`${LOCAL_API}/questions-bank/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return await res.json();
};

/** Save only the user-selected questions from the dialog */
export const saveBatchQuestions = async (
  questions: { text: string; category: string }[]
): Promise<GenerateResult> => {
  const res = await fetch(`${LOCAL_API}/questions-bank/save-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return await res.json() as GenerateResult;
};

/** Full pipeline: pull history → AI generate → save to DB → return all questions */
export const generateQuestionBank = async (count = 20): Promise<GenerateResult> => {
  const res = await fetch(`${LOCAL_API}/questions-bank/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return await res.json() as GenerateResult;
};

/** Add a single custom question */
export const addQuestionBankItem = async (text: string): Promise<QuestionBankItem> => {
  const res = await fetch(`${LOCAL_API}/questions-bank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.question as QuestionBankItem;
};

/** Delete a question by id */
export const deleteQuestionBankItem = async (id: string): Promise<void> => {
  const res = await fetch(`${LOCAL_API}/questions-bank/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
};

/** Delete ALL questions from bank */
export const clearQuestionBank = async (): Promise<void> => {
  const res = await fetch(`${LOCAL_API}/questions-bank`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
};

export const llmJudge = async (testMessage: string, botResponse: string, successCondition: string) => {
  const res = await fetch(`${LOCAL_API}/eval/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ testMessage, botResponse, successCondition }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json() as { pass: boolean; score: number; reason: string; detail?: string; method: string };
};

// ─── Golden Set ───────────────────────────────────────────────────────────────

export type GoldenLanguage = 'English' | 'Hindi' | 'Hinglish';
export type GoldenSubAgent = 'discovery' | 'session' | 'payment' | 'support' | 'faq' | null;

export interface GoldenScenario {
  id: string;
  title: string;
  description: string;
  language: GoldenLanguage;
  expectedSubAgent: GoldenSubAgent;
  initialMessage: string;
  expectedAnswer: string;
  passKeywords: string[];
  failKeywords: string[];
  tags: string[];
  mustPass: boolean;
  minScore: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoldenRun {
  index: number;
  pass: boolean;
  score: number;
  reason: string;
  responseText: string;
  responseTimeMs: number;
  agentType: string | null;
  error?: string;
}

export interface GoldenRunAggregate {
  scenarioId: string;
  scenarioTitle: string;
  mustPass: boolean;
  minScore: number;
  n: number;
  runs: GoldenRun[];
  medianScore: number;
  stdevScore: number;
  passCount: number;
  failCount: number;
  flaky: boolean;
  overallPass: boolean;
  regressionAlert: boolean;
  runAt: string;
}

export interface GoldenListResponse {
  version: number;
  updatedAt: string;
  count: number;
  scenarios: GoldenScenario[];
}

export const fetchGoldenScenarios = async (): Promise<GoldenListResponse> => {
  const res = await fetch(`${LOCAL_API}/golden`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return await res.json();
};

export const createGoldenScenario = async (scenario: Partial<GoldenScenario>): Promise<GoldenScenario> => {
  const res = await fetch(`${LOCAL_API}/golden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`API error ${res.status}: ${msg || res.statusText}`);
  }
  return await res.json();
};

export const updateGoldenScenario = async (id: string, scenario: Partial<GoldenScenario>): Promise<GoldenScenario> => {
  const res = await fetch(`${LOCAL_API}/golden/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`API error ${res.status}: ${msg || res.statusText}`);
  }
  return await res.json();
};

export const deleteGoldenScenario = async (id: string): Promise<void> => {
  const res = await fetch(`${LOCAL_API}/golden/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
};

export const runGoldenScenario = async (id: string, n: number = 3): Promise<GoldenRunAggregate> => {
  const res = await fetch(`${LOCAL_API}/golden/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ n }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`API error ${res.status}: ${msg || res.statusText}`);
  }
  return await res.json();
};

export interface GoldenBatchCallbacks {
  onStart?: (p: { total: number; n: number; startedAt: string }) => void;
  onProgress?: (p: { index: number; total: number; scenarioId: string; scenarioTitle: string }) => void;
  onResult?: (r: GoldenRunAggregate) => void;
  onError?: (e: { scenarioId?: string; error: string }) => void;
  onComplete?: (p: {
    total: number;
    passed: number;
    failed: number;
    mustPassFailures: number;
    flaky: number;
    results: GoldenRunAggregate[];
    finishedAt: string;
  }) => void;
}

export const runGoldenBatch = (
  n: number,
  mustPassOnly: boolean,
  cb: GoldenBatchCallbacks
): EventSource => {
  const url = `${LOCAL_API}/golden/run-all/stream?n=${n}${mustPassOnly ? '&mustPassOnly=1' : ''}`;
  const es = new EventSource(url);

  const safe = <T,>(fn: ((v: T) => void) | undefined, v: T) => { try { fn?.(v); } catch (e) { console.error(e); } };

  es.addEventListener('batch-start',     (e) => { try { safe(cb.onStart,    JSON.parse((e as MessageEvent).data)); } catch {} });
  es.addEventListener('batch-progress',  (e) => { try { safe(cb.onProgress, JSON.parse((e as MessageEvent).data)); } catch {} });
  es.addEventListener('scenario-result', (e) => { try { safe(cb.onResult,   JSON.parse((e as MessageEvent).data)); } catch {} });
  es.addEventListener('scenario-error',  (e) => { try { safe(cb.onError,    JSON.parse((e as MessageEvent).data)); } catch {} });
  es.addEventListener('batch-error',     (e) => { try { safe(cb.onError,    JSON.parse((e as MessageEvent).data)); } catch {} });
  es.addEventListener('batch-complete',  (e) => {
    try { safe(cb.onComplete, JSON.parse((e as MessageEvent).data)); } catch {}
    es.close();
  });
  es.onerror = () => {
    safe(cb.onError, { error: 'SSE stream closed' });
    es.close();
  };

  return es;
};

// ─────────────────────────────────────────────────────────────────────────────
// CZ Eval Score — multi-judge composite score pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface RubricDim {
  id: 'goal' | 'routing' | 'efficiency' | 'accuracy' | 'quality';
  label?: string;
  weight?: number;
}

export interface JudgeDetail {
  judgeId: string;
  backend: 'heuristic' | 'llm' | 'heuristic-fallback';
  overall: number;
  rationale: string;
}

export interface JudgeAggregate {
  overall: number;
  perDim: Partial<Record<RubricDim['id'], number>>;
  agreement: number;
  agreementTier?: 'strong' | 'moderate' | 'weak';
  judges: JudgeDetail[];
}

export interface ScenarioRun {
  pass: boolean;
  score: number;
  composite: number;
  agentType: string | null;
  responseTimeMs: number;
  responseText: string;
  judge: JudgeAggregate | null;
  hallucination: boolean;
  routingCorrect: boolean | null;
  error?: string;
  reason?: string;
}

export interface ScenarioScore {
  scenarioId: string;
  title: string;
  category: string | null;
  mustPass: boolean;
  weight: number;
  n: number;
  medianScore: number;
  stdevScore: number;
  flakiness: number;
  flakinessTier: 'stable' | 'wobbly' | 'flaky';
  passRate: number;
  overallPass: boolean;
  regressionAlert: boolean;
  perDim: Partial<Record<RubricDim['id'], number | null>>;
  agreement: number | null;
  hallucinationFreeRate: number;
  routingAccuracy: number;
  latencyRate: number;
  medianLatency: number;
  contribution?: number;
  runs: ScenarioRun[];
}

export interface StatusBand {
  min: number;
  label: string;
  color: string;
  tone: 'green' | 'yellow' | 'orange' | 'red';
}

export interface EvalScoreComponents {
  goldenPassRate: number;
  rubricAvg: number;
  hallucinationFree: number;
  routingAccuracy: number;
  latencySla: number;
  weights: {
    goldenPassRate: number;
    rubricAvg: number;
    hallucinationFree: number;
    routingAccuracy: number;
    latencySla: number;
  };
}

export interface EvalScoreStats {
  totalScenarios: number;
  passed: number;
  failed: number;
  flaky: number;
  mustPassTotal: number;
  mustPassFailed: number;
  avgAgreement: number;
  avgFlakiness: number;
}

export interface EvalScoreReport {
  empty?: boolean;
  czScore: number;
  confidence: number;
  deltaVsBaseline: number | null;
  baselineScore: number | null;
  status: StatusBand;
  components: EvalScoreComponents;
  stats: EvalScoreStats;
  scenarioBreakdown: ScenarioScore[];
  lowAgreement: Array<{
    scenarioId: string;
    title: string;
    agreement: number;
    medianScore: number;
  }>;
  failing: Array<{
    scenarioId: string;
    title: string;
    weight: number;
    medianScore: number;
    reason: string;
  }>;
  meta: {
    runId?: string;
    agentUrl?: string;
    n?: number;
    scope?: string;
    tags?: string[] | null;
    useLlm?: boolean;
    startedAt?: string;
    configHash?: string;
    rubricVersion?: string;
    computedAt?: string;
    nodeVersion?: string;
  };
}

export interface EvalTrendPoint {
  id: string;
  runAt: string;
  czScore: number;
  confidence?: number;
  status: string;
  statusTone: 'green' | 'yellow' | 'orange' | 'red';
  passed: number;
  failed: number;
  flaky: number;
}

export interface EvalRunHeader {
  id: string;
  czScore: number;
  confidence?: number;
  status: string;
  statusTone: 'green' | 'yellow' | 'orange' | 'red';
  deltaVsBaseline: number | null;
  scope: string;
  n: number;
  passed: number;
  failed: number;
  flaky: number;
  runAt: string;
  configHash?: string;
  error?: string;
}

export type EvalStreamEvent =
  | { type: 'start'; total: number; n: number; scope: string }
  | { type: 'scenario-start'; scenarioId: string; title: string; idx: number; total: number }
  | { type: 'scenario-done'; scenarioResult: ScenarioScore; idx: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'complete'; report: EvalScoreReport }
  | { type: 'error'; message: string };

export interface EvalRunOptions {
  n?: number;
  scope?: 'mustPass' | 'all' | 'tag';
  tags?: string[];
  useLlm?: boolean;
  agentUrl?: string;
}

export const fetchLatestEvalScore = async (): Promise<EvalScoreReport> => {
  const res = await fetch(`${LOCAL_API}/eval-score/latest`);
  if (!res.ok) throw new Error(`Failed to fetch latest eval score (${res.status})`);
  return res.json();
};

export const fetchEvalTrend = async (days = 30): Promise<{ days: number; count: number; series: EvalTrendPoint[] }> => {
  const res = await fetch(`${LOCAL_API}/eval-score/trend?days=${days}`);
  if (!res.ok) throw new Error(`Failed to fetch trend (${res.status})`);
  return res.json();
};

export const fetchEvalRuns = async (): Promise<{ count: number; runs: EvalRunHeader[] }> => {
  const res = await fetch(`${LOCAL_API}/eval-score/runs`);
  if (!res.ok) throw new Error(`Failed to fetch runs (${res.status})`);
  return res.json();
};

export const fetchEvalRun = async (id: string): Promise<EvalScoreReport> => {
  const res = await fetch(`${LOCAL_API}/eval-score/runs/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch run (${res.status})`);
  return res.json();
};

export const deleteEvalRun = async (id: string): Promise<{ ok: boolean }> => {
  const res = await fetch(`${LOCAL_API}/eval-score/runs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete run (${res.status})`);
  return res.json();
};

export interface EvalRunCallbacks {
  onEvent?: (evt: EvalStreamEvent) => void;
  onComplete?: (report: EvalScoreReport) => void;
  onError?: (err: { message: string }) => void;
}

export interface StartedEvalRun {
  runId: string;
  streamUrl: string;
  es: EventSource;
  close: () => void;
}

export const startEvalRun = async (
  opts: EvalRunOptions,
  cb: EvalRunCallbacks = {}
): Promise<StartedEvalRun> => {
  const res = await fetch(`${LOCAL_API}/eval-score/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Failed to start eval run (${res.status})`);
  const { runId, streamUrl } = await res.json();

  const es = new EventSource(streamUrl);
  es.onmessage = (e) => {
    let evt: EvalStreamEvent;
    try { evt = JSON.parse((e as MessageEvent).data); } catch { return; }
    try { cb.onEvent?.(evt); } catch (err) { console.error(err); }
    if (evt.type === 'complete') {
      try { cb.onComplete?.(evt.report); } catch (err) { console.error(err); }
      es.close();
    } else if (evt.type === 'error') {
      try { cb.onError?.({ message: evt.message }); } catch (err) { console.error(err); }
      es.close();
    }
  };
  es.onerror = () => {
    try { cb.onError?.({ message: 'SSE stream closed' }); } catch (err) { console.error(err); }
    es.close();
  };

  return {
    runId,
    streamUrl,
    es,
    close: () => es.close(),
  };
};
