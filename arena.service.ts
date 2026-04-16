import { orchestratorService } from '../orchestrator/orchestrator.service.js';
import { contextManager } from '../orchestrator/context-manager.js';
import { ChannelType, type ChannelMessage } from '../common/types/channel.types.js';
import { llmService } from '../llm/llm.service.js';
import { createLogger } from '../common/utils/logger.js';
import { TesterAgent } from './tester.agent.js';
import {
  type Persona,
  type SimulationGoal,
  type SimulationResult,
  type ConversationTurn,
  type SimulationEvent,
  type SimulationEventType,
  type DeterministicCheckResult,
  type RegressionAlert,
  type SupportedLanguage
} from './types.js';
import { historyService } from './history.service.js';
import { z } from 'zod';

const logger = createLogger('ArenaService');

const SLOW_TURN_THRESHOLD_MS = 6000; // 6 seconds per turn = slow

// ─── ChargeZone Policy Ground Truth (for LLM judge) ──────────────────────────
const CZ_POLICY_FACTS = `
### CHARGEZONE POLICY GROUND TRUTH (BRD 2.0)
- QR Flow: Scanning a QR auto-starts the session after payment. NO OTP IS NEEDED for QR scan flows.
- Discovery Flow: Bookings made via Discovery search get an OTP and a 15-min arrival window.
- Wallet/UPI: If wallet is insufficient, agent must provide a UPI link (e.g. Razorpay).
- Pricing: IOC co-branded = ₹14/kWh. Standard CZ = ₹18-₹20/kWh. Min booking: ₹100.
- Vehicle Support: 4-wheelers ONLY. 2/3-wheelers are NOT supported.
- Private Chargers: Agent MUST NEVER surface "Private" chargers in public Discovery results.
- Safety Override: Any mention of fire/smoke/shock/aag must immediately trigger a command to move away, call CZ support, and dial 112. The agent MUST NOT try to help with Discovery or Session info during safety events.
- RFID: Cards are free but must be requested via the App (no physical address form via WA).
- Agent must NOT treat a query as the user's name during registration.
- Context: If user already stated city, agent must NOT ask again. If the user clicks a button, the agent should not re-introduce itself starting from scratch.
`;

// ─── Deterministic Checks ─────────────────────────────────────────────────────

function runDeterministicChecks(
  transcript: ConversationTurn[],
  goal: SimulationGoal
): DeterministicCheckResult {
  const agentTurns  = transcript.filter(t => t.role === 'agent');
  const testerTurns = transcript.filter(t => t.role === 'tester');
  const agentTexts  = agentTurns.map(t => t.content.toLowerCase());
  const testerTexts = testerTurns.map(t => t.content.toLowerCase());

  // 1. Location loop
  const locationAsk = /\b(what(?:'s| is) your (location|city|address)|where are you(?: located)?|which city|please (?:share|provide|send)(?: your)? (?:location|city|address)|share your location)\b/;
  const locationLoopDetected = agentTexts.filter(m => locationAsk.test(m)).length >= 3;

  // 2. Safety misrouting
  const safetyTrigger = /\b(aag|fire|smoke|dhuan|electric shock|bijli lagi|blast|danger|aag lg|aag lagi|charger mein aag|charger se aag)\b/;
  const safetyTriggered = testerTexts.some(m => safetyTrigger.test(m));
  const safetyHandled   = agentTexts.some(m => /\b(safety|incident|report|emergency|support ticket|escalat|fire|smoke|danger)\b/.test(m));
  const safetyMisrouted = safetyTriggered && !safetyHandled;

  // 3. Name hallucination
  const nameHallucinationRx = /should i (?:register|create|add) (?:you|an account) as ["']?[\w\s]{5,}["']?\?/i;
  const agentHallucinatedName = agentTurns.some(t => nameHallucinationRx.test(t.content));

  // 4. Repetition loop
  const repeatPhraseRx = /\b(please (?:provide|share|tell me|confirm)|what is your|can you (?:please )?(?:share|tell|provide|confirm)|i need (?:your|more)|to (?:help|assist) you)\b/g;
  const phraseCounts: Record<string, number> = {};
  for (const msg of agentTexts) {
    const matches = [...msg.matchAll(repeatPhraseRx)];
    for (const m of matches) {
      const key = m[0].trim().toLowerCase().slice(0, 35);
      phraseCounts[key] = (phraseCounts[key] ?? 0) + 1;
    }
  }
  const stuckInRepetitionLoop = Object.values(phraseCounts).some(c => c >= 3);

  // 5. Wrong agent routing (if goal specifies expected agent)
  const agentTypesUsed = [...new Set(
    agentTurns.filter(t => t.metadata?.agentType).map(t => t.metadata!.agentType as string)
  )];
  const wrongAgentRouted = !!(
    goal.expectedAgentType &&
    agentTypesUsed.length > 0 &&
    !agentTypesUsed.includes(goal.expectedAgentType as string)
  );

  // 6. Latency stats
  const responseTimes = agentTurns
    .map(t => t.metadata?.responseTimeMs ?? 0)
    .filter(ms => ms > 0);
  const avgResponseTimeMs = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;
  const slowTurns = responseTimes.filter(ms => ms > SLOW_TURN_THRESHOLD_MS).length;

  // 7. Build penalty list
  const penalties: string[] = [];
  if (locationLoopDetected)  penalties.push('LOCATION_LOOP: Agent asked for location 3+ times (score capped at 40, forced fail)');
  if (safetyMisrouted)       penalties.push('SAFETY_MISROUTED: Emergency not handled by Support Agent (score capped at 15, forced fail)');
  if (agentHallucinatedName) penalties.push('NAME_HALLUCINATION: Agent treated query as user name (score capped at 35)');
  if (stuckInRepetitionLoop) penalties.push('REPETITION_LOOP: Agent repeated same request 3+ times (score capped at 50)');
  if (wrongAgentRouted)      penalties.push(`WRONG_ROUTING: Expected ${goal.expectedAgentType} but got ${agentTypesUsed.join(', ')} (score capped at 30)`);
  if (slowTurns > 0)         penalties.push(`SLOW_RESPONSE: ${slowTurns} turn(s) exceeded ${SLOW_TURN_THRESHOLD_MS / 1000}s (avg ${avgResponseTimeMs}ms)`);

  // Assertions check
  if (goal.assertions && goal.assertions.length > 0) {
    for (const assertion of goal.assertions) {
      if (assertion.type === 'contains_text') {
        const found = agentTexts.some(t => t.includes(assertion.value.toLowerCase()));
        if (!found) penalties.push(`ASSERTION_FAILED: Expected agent response to contain '${assertion.value}'`);
      } else if (assertion.type === 'tool_call') {
        const toolsFound = agentTurns.some(t => 
          (t.metadata?.suggestedActions as any[])?.some(a => a.action?.includes(assertion.value)) ||
          t.content.toLowerCase().includes(assertion.value.toLowerCase()) || 
          JSON.stringify(t.metadata?.data || {}).toLowerCase().includes(assertion.value.toLowerCase())
        );
        if (!toolsFound) penalties.push(`ASSERTION_FAILED: Expected agent to use tool/action containing '${assertion.value}'`);
      }
    }
  }

  return {
    locationLoopDetected,
    safetyMisrouted,
    agentHallucinatedName,
    stuckInRepetitionLoop,
    wrongAgentRouted,
    agentTypesUsed,
    turnsTaken: testerTurns.length,
    avgResponseTimeMs,
    slowTurns,
    penalties
  };
}

// ─── Regression Check ─────────────────────────────────────────────────────────

async function checkRegression(
  goal: SimulationGoal,
  currentScore: number
): Promise<RegressionAlert | undefined> {
  if (!goal.mustPass) return undefined;

  const minScore   = goal.mustPassMinScore ?? 70;
  const history    = await historyService.getHistory();
  const prevResult = history.find(h => h.goal.id === goal.id);

  const prevScore = prevResult?.score ?? minScore; // if no history, use threshold as baseline

  if (currentScore < minScore) {
    return {
      triggered: true,
      previousScore: prevScore,
      currentScore,
      drop: prevScore - currentScore,
      message: `⚠️ REGRESSION: "${goal.id}" scored ${currentScore} — below must-pass threshold of ${minScore}. Previous score: ${prevScore}.`
    };
  }
  return undefined;
}

// ─── Arena Service ────────────────────────────────────────────────────────────

export class ArenaService {
  private readonly maxTurns = 10;

  async runSimulation(
    persona: Persona,
    goal: SimulationGoal,
    evidenceContext?: string,
    onEvent?: (event: SimulationEvent) => void,
    signal?: AbortSignal,
    languageOverride?: SupportedLanguage,
    batchId?: string
  ): Promise<SimulationResult> {
    const simulationId  = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const runTimestamp  = new Date().toISOString();
    
    const activePersona = { ...persona };
    if (languageOverride) {
      activePersona.language = languageOverride;
    }

    const tester        = new TesterAgent(activePersona, goal, evidenceContext);
    const transcript: ConversationTurn[] = [];
    const userId        = '918000363019';
    const sessionId     = `whatsapp:${simulationId}`; // Unique session per run to prevent batch state leakage

    const broadcast = (type: SimulationEventType, payload: any) =>
      onEvent?.({ type, payload, timestamp: new Date() });

    logger.info({ simulationId, persona: persona.name, goal: goal.id }, '[ArenaService] Starting simulation');
    broadcast('status', { message: `Starting: ${persona.name}`, persona: persona.name });

    await contextManager.clearContext(userId, sessionId);

    const walletBalance =
      persona.id === 'p2_payment_disputer' ? 500 :
      persona.id === 'p9_zero_wallet'      ? 0   : 1500;

    const profile = {
      id: userId,
      phone: '918000363019',
      name: (persona as any).metadata?.realName || 'ChargeZone User',
      walletBalance,
      vehicles: [
        { id: 'veh_nexon', model: 'Tata Nexon EV',  plate: 'MH12AB1234', nickname: 'Nexon' },
        { id: 'veh_ola',   model: 'Ola S1 Pro',     plate: 'MH12CD5678', nickname: 'Scooter' }
      ]
    };

    await contextManager.updateContext(userId, sessionId, {
      userProfile: profile,
      metadata: {
        userVerified:    true,
        verifiedUser:    profile,
        isSimulation:    true,
        activeBookingId: persona.id === 'p6_qr_user' ? '65f1a2b3c4d5e6f7a8b9c0d1' : undefined
      }
    });

    let currentAgentResponse: string | undefined;
    let turnCount = 0;

    while (turnCount < this.maxTurns) {
      if (signal?.aborted) {
        broadcast('status', { message: 'Simulation aborted.' });
        break;
      }
      turnCount++;

      // ── Tester speaks ────────────────────────────────────────────────────────
      broadcast('status', { message: `${persona.name} is thinking... (turn ${turnCount}/${this.maxTurns})` });

      const testerResult  = await tester.getNextMessage(currentAgentResponse);
      const testerMessage = testerResult.content;

      const testerTurn: ConversationTurn = {
        role:      'tester',
        content:   testerMessage,
        timestamp: new Date(),
        metadata:  {
          thought: testerResult.thought,
          agentResponseAnalysis: testerResult.agentResponseAnalysis,
          terminationReason: testerResult.terminationReason,
          satisfiedWithResponse: testerResult.satisfied
        }
      };
      transcript.push(testerTurn);
      broadcast('turn', testerTurn);

      // ── Handle [ACTION:SHARE_LOCATION] ────────────────────────────────────────
      if (testerMessage.includes('[ACTION:SHARE_LOCATION]')) {
        broadcast('status', { message: '📍 Injecting mock GPS coordinates...' });
        
        // Pick coordinates based on persona context
        let lat = 19.0760, lng = 72.8777; // Default Mumbai
        const lowerContext = (evidenceContext || persona.description || '').toLowerCase();
        
        if (lowerContext.includes('jodhpur')) {
          lat = 26.2389; lng = 73.0243;
        } else if (lowerContext.includes('jaipur')) {
          lat = 26.9124; lng = 75.7873;
        } else if (lowerContext.includes('pune')) {
          lat = 18.5204; lng = 73.8567;
        } else if (lowerContext.includes('bangalore') || lowerContext.includes('blr')) {
          lat = 12.9716; lng = 77.5946;
        } else if (lowerContext.includes('delhi')) {
          lat = 28.6139; lng = 77.2090;
        }

        await contextManager.setLocation(userId, sessionId, {
          latitude: lat,
          longitude: lng,
          address: 'Mock Location',
          timestamp: new Date()
        });
      }

      // ── CZ Agent responds ────────────────────────────────────────────────────
      broadcast('status', { message: `CZ Agent processing... (turn ${turnCount})` });

      // Clean the message content for the orchestrator: 
      // If it contains a location share tag, we mimic real WhatsApp by sending 
      // empty content (or just the confirmation part if it's very short) 
      // so the AI doesn't trigger "Out of Scope" on the internal tag text.
      let contentToProcess = testerMessage;
      if (testerMessage.includes('[ACTION:SHARE_LOCATION]')) {
        contentToProcess = testerMessage.replace(/\[ACTION:SHARE_LOCATION\]/g, '').trim();
        // If the resulting message is just "Sure" or "Ok", or empty, we null it to 
        // mimic a 'pure' location share.
        if (contentToProcess.length < 5 || /^(ok|sure|yeah|yes|sharing)$/i.test(contentToProcess)) {
          contentToProcess = '';
        }
      }

      const channelMessage: ChannelMessage = {
        userId,
        messageId: `${simulationId}_turn_${turnCount}`,
        content:   contentToProcess,
        channel:   ChannelType.WHATSAPP,
        timestamp: new Date(),
        metadata:  { requestId: simulationId, isSimulation: true } as any
      };

      const agentStart  = Date.now();
      const orchResult  = await orchestratorService.processMessage(channelMessage);
      const responseTimeMs = Date.now() - agentStart;

      currentAgentResponse = orchResult.response.content;

      const agentTurn: ConversationTurn = {
        role:      'agent',
        content:   currentAgentResponse || '',
        timestamp: new Date(),
        metadata:  {
          agentType:      orchResult.agentType,
          responseTimeMs,
          suggestedActions: orchResult.response.suggestedActions,
          data:           orchResult.response.data
        }
      };
      transcript.push(agentTurn);
      broadcast('turn', agentTurn);

      // Log slow responses immediately
      if (responseTimeMs > SLOW_TURN_THRESHOLD_MS) {
        broadcast('status', { message: `⚠️ Slow response: ${responseTimeMs}ms on turn ${turnCount}` });
      }

      // ── End conditions ───────────────────────────────────────────────────────
      if (testerResult.done) {
        broadcast('status', { message: 'Customer goal achieved — ending simulation.' });
        break;
      }
      const lower = testerMessage.toLowerCase();
      if (lower.includes('goodbye') || lower.includes('thanks for help') || lower.includes('thank you, bye')) {
        break;
      }
      
      if (turnCount >= this.maxTurns) {
        broadcast('status', { message: `⚠️ Max turns (${this.maxTurns}) reached. Simulation stalled.` });
      }
    }
    
    let stalled = false;
    if (turnCount >= this.maxTurns && transcript[transcript.length - 1].role !== 'tester' && !transcript.some(t => t.role === 'tester' && t.metadata?.terminationReason)) {
      stalled = true;
    }

    // ── Deterministic checks ─────────────────────────────────────────────────
    broadcast('status', { message: 'Running deterministic quality checks...' });
    const deterministicChecks = runDeterministicChecks(transcript, goal);

    if (stalled) {
      deterministicChecks.penalties.push('MAX_TURNS_EXCEEDED: Failed to achieve goal in 10 turns (score capped at 0, forced fail)');
    }

    if (deterministicChecks.penalties.length > 0) {
      broadcast('status', {
        message: `⚠️ ${deterministicChecks.penalties.length} issue(s) detected`,
        penalties: deterministicChecks.penalties
      });
    }

    // ── LLM Judge ────────────────────────────────────────────────────────────
    broadcast('status', { message: 'Senior Judge is reviewing the full transcript...' });
    const judgeResult = await this.judgeSimulation(persona, goal, transcript, deterministicChecks);

    // ── Apply deterministic overrides on top of LLM score ────────────────────
    let finalScore   = judgeResult.score;
    let finalSuccess = judgeResult.success;

    if (deterministicChecks.safetyMisrouted)       { finalScore = Math.min(finalScore, 15); finalSuccess = false; }
    if (deterministicChecks.locationLoopDetected)   { finalScore = Math.min(finalScore, 40); finalSuccess = false; }
    if (deterministicChecks.wrongAgentRouted)        { finalScore = Math.min(finalScore, 30); finalSuccess = false; }
    if (deterministicChecks.agentHallucinatedName)   { finalScore = Math.min(finalScore, 35); }
    if (deterministicChecks.stuckInRepetitionLoop)   { finalScore = Math.min(finalScore, 50); }
    if (stalled)                                     { finalScore = 0; finalSuccess = false; }

    const penaltyNote = deterministicChecks.penalties.length > 0
      ? ` | PENALTIES: ${deterministicChecks.penalties.join(' | ')}`
      : '';

    // ── Regression check ─────────────────────────────────────────────────────
    const regressionAlert = await checkRegression(goal, finalScore);
    if (regressionAlert?.triggered) {
      broadcast('status', { message: regressionAlert.message });
      logger.warn({ simulationId, regressionAlert }, '[ArenaService] Regression alert triggered');
    }

    const simulationResult: SimulationResult = {
      simulationId,
      runTimestamp,
      persona,
      goal,
      transcript,
      success:             finalSuccess,
      score:               finalScore,
      llmScore:            judgeResult.score,
      judgeReasoning:      judgeResult.reasoning + penaltyNote,
      deterministicChecks,
      totalTurns:          turnCount,
      tokensUsed:          0, // Placeholder: token counting not available from orchestrator
      regressionAlert,
      languageOverride,
      batchId,
      agentVersion:        process.env.npm_package_version || '1.0.0',
      stalled,
    };

    broadcast('result', simulationResult);
    return simulationResult;
  }

  // ─── LLM Judge ─────────────────────────────────────────────────────────────

  private async judgeSimulation(
    persona: Persona,
    goal: SimulationGoal,
    transcript: ConversationTurn[],
    flags: DeterministicCheckResult
  ): Promise<{ success: boolean; score: number; reasoning: string }> {
    const transcriptStr = transcript
      .map(t => {
        const role     = t.role === 'agent' ? 'CZ_AGENT' : 'CUSTOMER';
        const agentTag = t.metadata?.agentType      ? ` [${t.metadata.agentType}]`      : '';
        const timeTag  = t.metadata?.responseTimeMs ? ` (${t.metadata.responseTimeMs}ms)` : '';
        // Bias fix: Do NOT include termination reason so the Judge evaluates independently
        return `${role}${agentTag}${timeTag}: ${t.content}`;
      })
      .join('\n');

    const deterministicSummary = `
### PRE-COMPUTED DETERMINISTIC FLAGS (factual — trust completely):
- Location loop (3+ asks): ${flags.locationLoopDetected ? 'YES ⚠️' : 'No ✓'}
- Safety emergency misrouted: ${flags.safetyMisrouted ? 'YES ⚠️ CRITICAL' : 'No ✓'}
- Agent hallucinated name: ${flags.agentHallucinatedName ? 'YES ⚠️' : 'No ✓'}
- Stuck in repetition loop: ${flags.stuckInRepetitionLoop ? 'YES ⚠️' : 'No ✓'}
- Wrong agent type routed: ${flags.wrongAgentRouted ? 'YES ⚠️' : 'No ✓'}
- Avg response time: ${flags.avgResponseTimeMs}ms${flags.slowTurns > 0 ? ` (${flags.slowTurns} slow turns ⚠️)` : ' ✓'}
- Agents used: ${flags.agentTypesUsed.join(', ') || 'unknown'}
- Customer turns: ${flags.turnsTaken}`;

    const systemPrompt = `You are a Senior QA Judge for ChargeZone's AI WhatsApp support agent.
${CZ_POLICY_FACTS}

### SCENARIO
Persona: ${persona.name} — ${persona.description}
Objective: ${goal.objective}
Success Condition: ${goal.successCondition}
${goal.expectedAgentType ? `Expected Agent: ${goal.expectedAgentType}` : ''}
${deterministicSummary}

### TRANSCRIPT
${transcriptStr}

### SCORING RUBRIC (100 pts total)

1. Goal Achievement (40 pts)
   40 = fully achieved, customer satisfied
   25 = mostly achieved, small gap
   10 = partial progress
    0 = not achieved

2. Routing Accuracy (20 pts)
   20 = correct agent used throughout
   10 = mostly correct, one slip
    0 = wrong agent for primary intent

3. Efficiency (20 pts)
   20 = goal in 2–3 turns
   15 = 4–5 turns
   10 = 6–7 turns
    5 = 8–9 turns
    0 = 10 turns, stalled

4. Information Accuracy (10 pts)
   10 = all facts match ChargeZone ground truth above
    5 = minor inaccuracy
    0 = major factual error (wrong pricing, wrong RFID process, etc.)

5. Response Quality (10 pts)
   10 = professional, concise, language-matched (Hinglish if customer used Hinglish)
    5 = adequate but wordy or slightly off-tone
    0 = unprofessional or confusing

### CALIBRATION EXAMPLES (use these to anchor your scores)

GOAL ACHIEVEMENT (40 pts):
  40: Goal fully met.
  25: Partial success. Example: User asked for charger. Agent found one but gave wrong pricing (₹0/kWh) and user had to correct the agent.
  10: Agent found charger but confused user with wrong connector options. User gave up.
   0: Agent failed to find anything or entered a loop.

ROUTING ACCURACY (20 pts):
  20: Expected agent handled intent fully.
  10: Ping-ponged between agents but successfully resolved.
   0: Example: User said "aag lagi hai" and was sent to Discovery instead of Support.

INSTRUCTIONS: 
Score each dimension FIRST and INDEPENDENTLY. Do not consider the total.
Then sum them for the final score.

### OUTPUT — valid JSON only, no markdown:
{
  "success": <boolean>,
  "score": <0–100>,
  "goalScore": <0–40>,
  "routingScore": <0–20>,
  "efficiencyScore": <0–20>,
  "accuracyScore": <0–10>,
  "qualityScore": <0–10>,
  "stalled": <boolean>,
  "reasoning": "<2–4 sentences: what went right, what went wrong>"
}`;

    const JudgeSchema = z.object({
      success:         z.boolean(),
      score:           z.number().min(0).max(100),
      goalScore:       z.number().min(0).max(40),
      routingScore:    z.number().min(0).max(20),
      efficiencyScore: z.number().min(0).max(20),
      accuracyScore:   z.number().min(0).max(10),
      qualityScore:    z.number().min(0).max(10),
      stalled:         z.boolean().optional(),
      reasoning:       z.string()
    }).refine(d => Math.abs(d.score - (d.goalScore + d.routingScore + d.efficiencyScore + d.accuracyScore + d.qualityScore)) <= 1,
      { message: 'score must equal sum of sub-scores' }
    );

    try {
      const response = await llmService.generateStructured(
        { systemPrompt, userMessage: 'Evaluate and return JSON.', jsonMode: true, maxTokens: 1024 },
        JudgeSchema,
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-test-placeholder' 
          ? ((process.env.TESTER_LLM_PROVIDER as any) || 'anthropic') 
          : 'gemini'
      );
      return { success: response.success, score: response.score, reasoning: response.reasoning };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, '[ArenaService] Judge failed');
      return { success: false, score: 0, reasoning: 'Judge LLM failed. Manual review required.' };
    }
  }
}

export const arenaService = new ArenaService();
