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
