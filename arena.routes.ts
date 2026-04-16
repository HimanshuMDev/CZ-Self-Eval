import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { arenaService } from './arena.service.js';
import { createLogger } from '../common/utils/logger.js';
import { personas, sampleGoals } from './persona.registry.js';
import { evidenceScenarios } from './evidence.registry.js';
import { historyService } from './history.service.js';
import { metricsService } from './metrics.service.js';
import { sandboxService } from './sandbox.service.js';
import { chatSessionService } from './chat-session.service.js';

const allPersonas = [...personas, ...evidenceScenarios.map(s => s.persona)];
const allGoals = [...sampleGoals, ...evidenceScenarios.map(s => s.goal)];

// ─── Custom Persona Builder ───────────────────────────────────────────────────
// Used when the user writes their own scenario in the Run Duel dialog.
function buildCustomPersona(scenarioText: string) {
  const persona = {
    id: 'custom',
    name: 'Custom Scenario Tester',
    description: 'A realistic EV charging customer simulating a user-defined scenario.',
    emotionalState: 'neutral' as const,
    language: 'English' as const,
    behaviorRules: [
      'Follow the custom scenario description closely — it defines who you are and what you want.',
      'Be natural and conversational — this is WhatsApp, keep messages short.',
      'If the agent asks for info you already gave, call it out politely.',
      'Push back when the agent is vague or unhelpful.',
    ],
    primaryGoal: {
      id: 'custom_goal',
      objective: scenarioText.trim().slice(0, 400),
      successCondition: 'The agent fully addresses the scenario and the customer\'s need is resolved.'
    }
  };
  return { persona, goal: persona.primaryGoal };
}

const logger = createLogger('ArenaRoutes');
const arena = new Hono();

// List all available personas
arena.get('/personas', (c) => {
  return c.json({ personas: allPersonas });
});

// List sample goals
arena.get('/goals', (c) => {
  return c.json({ goals: allGoals });
});

// List evidence scenarios
arena.get('/evidence', (c) => {
  return c.json({ evidence: evidenceScenarios });
});

// List simulation history
arena.get('/history', async (c) => {
  const history = await historyService.getHistory();
  return c.json({ history });
});

// GET /stream - SSE endpoint for real-time simulation
arena.get('/stream', (c) => {
  const personaId = c.req.query('personaId');
  const goalId = c.req.query('goalId');
  const evidenceContext = c.req.query('evidenceContext');
  const languageOverride = c.req.query('language') as any;

  // ── Custom scenario: user typed their own scenario in the Run Duel dialog ──
  if (personaId === 'custom' && evidenceContext && evidenceContext.trim().length > 0) {
    const { persona: customPersona, goal: customGoal } = buildCustomPersona(evidenceContext);
    logger.info({ scenarioLength: evidenceContext.length }, '[ArenaAPI] Starting custom scenario simulation');
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      try {
        // Pass evidenceContext as the scenario context so TesterAgent uses it as framing
        const result = await arenaService.runSimulation(customPersona, customGoal, evidenceContext, async (event) => {
          const data = JSON.stringify(event.payload);
          if (typeof (stream as any).writeSSE === 'function') {
            await (stream as any).writeSSE({ data, event: event.type, id: String(Date.now()) });
          } else {
            await stream.write(`event: ${event.type}\ndata: ${data}\nid: ${Date.now()}\n\n`);
          }
        }, controller.signal, languageOverride);
        await historyService.saveResult(result);
      } catch (error) {
        logger.error({ error }, '[ArenaAPI] Custom scenario simulation failed');
        await stream.writeSSE({ data: JSON.stringify({ error: 'Simulation failed' }), event: 'error' });
      }
    });
  }

  const persona = allPersonas.find(p => p.id === personaId);
  // Fallback: if goalId is missing, check if persona has a primaryGoal
  const goal = allGoals.find(g => g.id === goalId) || persona?.primaryGoal;

  logger.info({ personaId, goalId, personaFound: !!persona, goalFound: !!goal }, '[ArenaAPI] SSE Request received');

  if (!persona || !goal) {
    logger.warn({ personaId, goalId }, '[ArenaAPI] Invalid persona or goal ID requested');
    return c.json({ error: 'Invalid persona or goal', personaId, goalId }, 400);
  }

  return streamSSE(c, async (stream) => {
    logger.info({ personaId, goalId }, '[ArenaAPI] Starting streaming simulation');
    const controller = new AbortController();
    
    stream.onAbort(() => {
      logger.info({ personaId, goalId }, '[ArenaAPI] Client disconnected, aborting simulation');
      controller.abort();
    });

    try {
      const result = await arenaService.runSimulation(persona, goal, evidenceContext, async (event) => {
        const data = JSON.stringify(event.payload);
        if (typeof (stream as any).writeSSE === 'function') {
          await (stream as any).writeSSE({
            data,
            event: event.type,
            id: String(Date.now())
          });
        } else {
          // Fallback to manual SSE formatting if helper is missing
          // IMPORTANT: Must follow SSE protocol: event: ...\ndata: ...\nid: ...\n\n
          const chunk = `event: ${event.type}\ndata: ${data}\nid: ${Date.now()}\n\n`;
          await stream.write(chunk);
        }
      }, controller.signal, languageOverride);
      
      await historyService.saveResult(result);
    } catch (error) {
      logger.error({ error }, '[ArenaAPI] Streaming simulation failed');
      const errMessage = error instanceof Error ? error.message : String(error);
      const data = JSON.stringify({ error: errMessage });
      if (typeof (stream as any).writeSSE === 'function') {
        await (stream as any).writeSSE({
          data,
          event: 'error',
          id: String(Date.now())
        });
      } else {
        await stream.write(`event: error\ndata: ${data}\nid: ${Date.now()}\n\n`);
      }
    }
  });
});

// GET /batch/stream - Run all evidence scenarios in a single stream
arena.get('/batch/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const batchId = `batch_${Date.now()}`;
    logger.info({ batchId }, '[ArenaAPI] Starting batch regression suite');
    const controller = new AbortController();
    
    stream.onAbort(() => {
      logger.info({ batchId }, '[ArenaAPI] Batch stream aborted by client');
      controller.abort();
    });

    try {
      const total = evidenceScenarios.length;
      
      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) break;

        const { persona, goal } = evidenceScenarios[i];

        // Notify client of batch progress
        await (stream as any).writeSSE({
          data: JSON.stringify({
            batchId,
            current: i + 1,
            total,
            personaName: persona.name,
            goalId: goal.id
          }),
          event: 'batch-progress',
          id: String(Date.now())
        });

        try {
          // Run the individual simulation
          const result = await arenaService.runSimulation(
            persona,
            goal,
            undefined,
            async (event) => {
              // Forward internal simulation events to the batch stream
              await (stream as any).writeSSE({
                data: JSON.stringify(event.payload),
                event: event.type,
                id: String(Date.now())
              });
            },
            controller.signal,
            undefined,
            batchId
          );

          await historyService.saveResult(result);
        } catch (simulationError) {
          // On individual simulation failure, send error event for this scenario and continue with next
          const errMessage = simulationError instanceof Error ? simulationError.message : String(simulationError);
          logger.error({
            batchId,
            personaId: persona.id,
            goalId: goal.id,
            error: simulationError
          }, '[ArenaAPI] Individual simulation in batch failed');

          await (stream as any).writeSSE({
            data: JSON.stringify({
              batchId,
              current: i + 1,
              total,
              personaName: persona.name,
              goalId: goal.id,
              error: `Simulation failed: ${errMessage}`
            }),
            event: 'batch-scenario-error',
            id: String(Date.now())
          });
        }
      }

      const finalHistory = await historyService.getHistory();
      const batchResults = finalHistory.filter(h => h.batchId === batchId);
      const passed = batchResults.filter(r => r.success).length;

      await (stream as any).writeSSE({
        data: JSON.stringify({
          batchId,
          total,
          passed,
          failed: total - passed,
          results: batchResults.map(r => ({ id: r.simulationId, success: r.success, score: r.score }))
        }),
        event: 'batch-complete',
        id: String(Date.now())
      });

    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error, batchId }, '[ArenaAPI] Batch simulation failed');
      await (stream as any).writeSSE({
        data: JSON.stringify({ error: errMessage }),
        event: 'error',
        id: String(Date.now())
      });
    }
  });
});

// POST /simulate - Legacy one-shot simulation
arena.post('/simulate', async (c) => {
  const { personaId, goalId, evidenceContext, language } = await c.req.json();
  
  const persona = allPersonas.find(p => p.id === personaId);
  const goal = allGoals.find(g => g.id === goalId);
  
  if (!persona || !goal) {
    return c.json({ success: false, error: 'Invalid persona or goal' }, 400);
  }
  
  logger.info({ personaId, goalId }, '[ArenaAPI] Starting simulation request');
  
  try {
    const result = await arenaService.runSimulation(persona, goal, evidenceContext, undefined, undefined, language);
    await historyService.saveResult(result);
    return c.json({ success: true, result });
  } catch (error) {
    logger.error({ error }, '[ArenaAPI] Simulation failed');
    return c.json({ success: false, error: 'Simulation failed' }, 500);
  }
});

// GET /metrics - Full eval metrics summary (pass rates, coverage, regressions)
arena.get('/metrics', async (c) => {
  const summary = await metricsService.getSummary();
  return c.json(summary);
});

// GET /metrics/must-pass - Status of all must-pass scenarios
arena.get('/metrics/must-pass', async (c) => {
  const status = await metricsService.getMustPassStatus();
  return c.json({ mustPass: status });
});

// GET /metrics/trend/:goalId - Score trend for a specific scenario
arena.get('/metrics/trend/:goalId', async (c) => {
  const goalId = c.req.param('goalId');
  const lastN  = parseInt(c.req.query('lastN') ?? '10', 10);
  const trend  = await metricsService.getTrend(goalId, lastN);
  return c.json({ goalId, trend });
});

// POST /history/:id/comments - Add a comment to a simulation run
arena.post('/history/:id/comments', async (c) => {
  const id = c.req.param('id');
  const { text } = await c.req.json();
  await historyService.addComment(id, text);
  return c.json({ success: true });
});

// POST /history/:id/report - Save a generated report
arena.post('/history/:id/report', async (c) => {
  const id = c.req.param('id');
  const { reportMarkdown } = await c.req.json();
  await historyService.saveReport(id, reportMarkdown);
  return c.json({ success: true });
});

// --- Sandbox Routes ---

arena.get('/sandbox', async (c) => {
  const scenarios = await sandboxService.getScenarios();
  return c.json(scenarios);
});

arena.post('/sandbox', async (c) => {
  const body = await c.req.json();
  const newScenario = await sandboxService.saveScenario({
    title: body.title,
    description: body.description,
    scenarioContext: body.scenarioContext
  });
  return c.json(newScenario);
});

arena.delete('/sandbox/:id', async (c) => {
  const id = c.req.param('id');
  await sandboxService.deleteScenario(id);
  return c.json({ success: true });
});

// --- Manual Chat Routes ---

arena.post('/chat', async (c) => {
  const { content, userId = '918000363019', sessionId = 'whatsapp:918000363019' } = await c.req.json();
  const startTime = Date.now();
  
  logger.info({ userId, contentLength: content.length }, '[ArenaAPI] Manual chat request');
  
  try {
    const channelMessage = {
      userId,
      messageId: `chat_${Date.now()}`,
      content,
      channel: 'whatsapp' as any,
      timestamp: new Date(),
      metadata: { isSimulation: true } // Treated as simulation context for safety
    };

    const orchestratorService = (arenaService as any).orchestratorService;
    // Note: arenaService doesn't export orchestratorService directly, but it's a singleton in the app.
    // For safety, I'll rely on the orchestratorService singleton being available in the module scope.
    // In this codebase, orchestratorService is imported in arena.service.ts.
    
    // Actually, I can just import it directly here.
    const { orchestratorService: orch } = await import('../orchestrator/orchestrator.service.js');
    
    const result = await orch.processMessage(channelMessage);
    return c.json({ 
      success: true, 
      result: {
        ...result,
        processingTimeMs: Date.now() - startTime
      } 
    });
  } catch (error) {
    logger.error({ error }, '[ArenaAPI] Manual chat failed');
    return c.json({ success: false, error: 'Chat processing failed' }, 500);
  }
});

arena.post('/chat/reset', async (c) => {
  const { userId = '918000363019', sessionId = 'whatsapp:918000363019' } = await c.req.json();
  const { contextManager } = await import('../orchestrator/context-manager.js');
  await contextManager.clearContext(userId, sessionId);
  return c.json({ success: true, message: 'Context cleared' });
});

// --- Manual Chat Session Persistence ---

// Save a complete chat session
arena.post('/chat-sessions', async (c) => {
  const session = await c.req.json();
  await chatSessionService.saveChatSession(session);
  return c.json({ success: true });
});

// Get all saved chat sessions (list view)
arena.get('/chat-sessions', async (c) => {
  const sessions = await chatSessionService.getChatSessions();
  // Return without full messages for list view performance
  return c.json({
    sessions: sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      totalMessages: s.totalMessages,
      totalAgentMessages: s.totalAgentMessages,
      avgResponseTimeMs: s.avgResponseTimeMs,
      agentTypesUsed: s.agentTypesUsed,
      flags: s.flags,
      summary: s.summary,
    }))
  });
});

// Export ALL sessions with full messages (for bulk JSON download)
arena.get('/chat-sessions/export/all', async (c) => {
  const sessions = await chatSessionService.getAllChatSessions();
  return c.json(sessions);
});

// Bulk import sessions
arena.post('/chat-sessions/import', async (c) => {
  const body = await c.req.json();
  const sessions = Array.isArray(body) ? body : [body];
  const imported = await chatSessionService.importChatSessions(sessions);
  return c.json({ success: true, imported });
});

// Get a single chat session with full messages
arena.get('/chat-sessions/:id', async (c) => {
  const id = c.req.param('id');
  const session = await chatSessionService.getChatSession(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

// Delete a chat session
arena.delete('/chat-sessions/:id', async (c) => {
  const id = c.req.param('id');
  await chatSessionService.deleteChatSession(id);
  return c.json({ success: true });
});

export { arena };
