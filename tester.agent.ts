import { z } from 'zod';
import { llmService } from '../llm/llm.service.js';
import { createLogger } from '../common/utils/logger.js';
import { type Persona, type SimulationGoal } from './types.js';

const logger = createLogger('TesterAgent');

const TesterResponseSchema = z.object({
  agentResponseAnalysis: z.string().describe(
    'Strict requirement: FIRST analyze what the CZ agent just said. Break down their meaning, intent, and whether it helps you, before deciding your next move.'
  ),
  thought: z.string().describe(
    'Your internal reasoning: based on your analysis, what is your next move as this customer?'
  ),
  message: z.string().describe(
    'The actual WhatsApp message you send. Short and human — 1-2 sentences max.'
  ),
  satisfied: z.boolean().describe(
    'Did the agent\'s last reply actually address your current need? false = vague/wrong/off-topic answer, true = helpful and relevant.'
  ),
  done: z.boolean().describe(
    'Set to true ONLY when your conversation is finished (either goal achieved, or you gave up/escalated).'
  ),
  terminationReason: z.enum(['goal_achieved', 'escalated_to_human', 'gave_up', 'continuing']).describe(
    'If done is false, this must be "continuing". If done is true, state why.'
  ).optional()
});

// ─── Real ChargeZone Knowledge Base ──────────────────────────────────────────
// Injected so the TesterAgent can:
// (a) simulate a realistic, informed customer
// (b) detect when the CZ agent gives factually wrong information
// (c) react correctly to known bug patterns from real traces

const CZ_CUSTOMER_KNOWLEDGE = `
=== WHAT YOU KNOW AS A CHARGEZONE CUSTOMER FROM REAL EXPERIENCE ===

COVERAGE & CITIES:
- ChargeZone has stations across India.
- You can search by City, Landmark, Route, or share Live Location.
- Private chargers exist, but the bot should never surface them to you natively.

CHARGER IDs, MENUS & FLOWS — CRITICAL RULES:
- You ONLY know charger IDs if you just scanned a QR (simulated) or the agent told you.
- INTERACTIVE MENUS: When the agent sends WhatsApp lists or buttons (e.g., "1. *Station Name*"), IT IS WAITING FOR YOU TO CLICK. You must reply by choosing an option (e.g., "Option 1" or "Mangal"). Do not ignore the list!

CHARGING & PAYMENT JOURNEYS:
1. QR Scan Flow: If you start by saying you scanned a QR, you DO NOT need to do location discovery. A QR triggers auto-start on successful payment. No OTP is needed. If you have ₹0 wallet balance, the bot MUST provide a UPI link to proceed.
2. WhatsApp Discovery Flow: If you search for a charger and book it, you receive an OTP and have a 15-minute arrival window. You use that OTP at the charger.
3. Pricing: Standard is ₹14-₹20/kWh for DC fast chargers. Minimum to charge is ₹100.
4. Auto-stop: At 80% battery, the bot usually asks if you want to stop early or continue.

VEHICLES & LIMITATIONS:
- ChargeZone supports 4-WHEELERS ONLY. If you ask for a 2-wheeler or 3-wheeler charger, the bot should explicitly say they don't support it.
- Wallet balance is strictly your money. If the bot exposes someone else's balance or gets yours wildly wrong (based on your persona), push back.
- You cannot request a physical RFID card via WhatsApp chat (address form limitation), the bot should refer you to the app.
- For Phone Number updates, the bot should refer you to the app.

SAFETY & EMERGENCIES:
- If you use keywords like "fire", "smoke", "spark", "electric shock", or "aag", the agent MUST immediately tell you to move away and call 112/emergency support. It must NEVER ask for your location first, and NEVER show you chargers.

HINGLISH PHRASES REAL USERS SAY:
- "charger kahan hai?" → where is the charger?
- "mera session start nahi ho raha" → my session won't start
- "paise kaat liye par session shuru nahi hua" → money deducted but session didn't start
- "mera refund kab tak aayega?" → when will I get my refund?
- "kitna charge lagega?" → how much will it cost?
- "aag lg gyi / aag lagi hai" → fire! (SAFETY EMERGENCY)
- "dhuan aa raha hai charger se" → smoke from the charger (SAFETY EMERGENCY)

KNOWN AGENT BUGS & RED FLAGS — FAIL THE BOT IF YOU SEE THESE:
1. Mid-flow Amnesia: If the agent re-introduces itself ("Hi, I am ChargeZone...") in the middle of your conversation after a button tap, react with confusion: "Why are you introducing yourself again? I just clicked your button."
2. Safety Ignored: Agent gives Discovery results or asks questions when you reported a fire/smoke emergency. -> VERY WRONG.
3. Location Loop: Agent asks for your location again after you already gave it. -> Call it out.
4. Asking for OTP on QR: If you scanned a QR, there is no OTP. If the agent asks for one, say: "I scanned the QR, there shouldn't be an OTP."
5. Name Hallucination: Agent says "Should I register you as [your query text]?" -> Say: "That is not my name."
`;

/**
 * TesterAgent simulates a real Indian EV charging customer on WhatsApp.
 * - Grounded in real ChargeZone product knowledge to detect hallucinations
 * - Language-aware: can simulate English, Hindi, or Hinglish customers
 * - Goal-driven: sends a `done` signal when the objective is achieved
 * - Loop-aware: escalates appropriately when agent repeats itself
 */
export class TesterAgent {
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private turnCount = 0;

  constructor(
    private readonly persona: Persona,
    private readonly goal: SimulationGoal,
    private readonly evidenceContext?: string
  ) {}

  private unsatisfiedCount = 0;

  async getNextMessage(lastAgentMessage?: string): Promise<{ content: string; thought: string; agentResponseAnalysis?: string; done?: boolean; terminationReason?: string; satisfied?: boolean }> {
    this.turnCount++;
    const systemPrompt = this.buildSystemPrompt();

    try {
      // Vary the nudge slightly per turn to reduce repetition — give the LLM
      // a different framing seed each time so phrasing doesn't get locked in.
      const turnNudge = [
        'Answer their question clearly, then ask your follow-up.',
        'React naturally. If they asked for info, provide it.',
        'Stay in character. Be specific about what you need.',
        'Push for a concrete answer if they are being vague.',
        'Keep it brief and direct like a real WhatsApp message.',
        "Show your personality. Don't sound like a robot.",
        'Reply directly to their last point.',
      ][this.turnCount % 7];

      let promptText = `Start the conversation now. Your goal: ${this.goal.objective}`;
      if (lastAgentMessage) {
        promptText = `[CZ AGENT SAID]:\n"${lastAgentMessage}"\n\n[INSTRUCTIONS FOR TURN ${this.turnCount}]:\n${turnNudge}`;
      }

      const response = await llmService.generateStructured(
        {
          systemPrompt,
          userMessage: promptText,
          conversationHistory: this.history,
          temperature: 0.65,
          jsonMode: true,
          maxTokens: 1024
        },
        TesterResponseSchema,
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-test-placeholder' 
          ? ((process.env.TESTER_LLM_PROVIDER as any) || 'anthropic') 
          : 'gemini'
      );

      // Now add to internal history so the prompt transcript is completely clean 
      // of our meta-instructions ("promptText") for future loops.
      if (lastAgentMessage) {
        this.history.push({ role: 'user', content: lastAgentMessage });
      }
      this.history.push({ role: 'assistant', content: response.message });

      // Track dissatisfaction — if agent keeps giving unhelpful responses, escalate
      if (!response.satisfied) {
        this.unsatisfiedCount++;
      } else {
        this.unsatisfiedCount = 0; // reset on a good response
      }

      // Force escalation after 3 consecutive unsatisfied responses
      const forcedEscalation = this.unsatisfiedCount >= 3 && !response.done;
      const finalMessage = forcedEscalation
        ? 'This is not helpful. Can I please speak to a human agent?'
        : response.message;

      const isDone = forcedEscalation ? true : response.done;
      let finalReason = response.terminationReason || 'continuing';
      if (forcedEscalation) finalReason = 'escalated_to_human';
      else if (isDone && finalReason === 'continuing') finalReason = 'goal_achieved';

      return {
        content:   finalMessage,
        agentResponseAnalysis: response.agentResponseAnalysis,
        thought:   forcedEscalation
          ? `[FORCED ESCALATION] Agent gave ${this.unsatisfiedCount} consecutive unhelpful responses. Demanding human agent.`
          : response.thought,
        done:      isDone,
        terminationReason: finalReason,
        satisfied: response.satisfied
      };
    } catch (error) {
      logger.error({
        error:       error instanceof Error ? error.message : String(error),
        personaId:   this.persona.id,
        stack:       error instanceof Error ? error.stack : undefined
      }, '[TesterAgent] LLM generation failed');

      return {
        content: 'Sorry, one moment.',
        thought: `LLM failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        done:    false
      };
    }
  }

  private buildSystemPrompt(): string {
    const rulesBlock = this.persona.behaviorRules
      .map((r, i) => `${i + 1}. ${r}`)
      .join('\n');

    const isHinglish = this.persona.language === 'Mixed' || this.persona.language === 'Hinglish' || this.persona.language === 'Hindi';

    const languageGuide = isHinglish
      ? `
LANGUAGE — YOU SPEAK HINGLISH:
- Mix Hindi and English in the same sentence naturally
- Examples: "mera charger scan nahi ho raha, what to do?", "yaar, help karo please"
- Short Hindi: "theek hai", "achha", "arre yaar", "kya baat hai", "same question phir se?"
- Keep it natural — don't over-translate, just mix as Indians actually do`
      : `
LANGUAGE — YOU SPEAK ENGLISH:
- Simple, direct English
- No need for Hindi phrases unless it feels natural`;

    const isCustomScenario = this.persona.id === 'custom';
    const evidenceBlock = this.evidenceContext
      ? (isCustomScenario 
          ? `\n### CUSTOM INITIAL CONTEXT:\nUse the following situation to form your first message and guide your behavior:\n"${this.evidenceContext}"\n`
          : `\n### THIS IS A REPLAY SCENARIO (from a real failing trace):\n${this.evidenceContext}\n`)
      : '';

    return `You are a REAL HUMAN customer of ChargeZone, India's EV charging network.
You are chatting with their AI support bot on WhatsApp. You are NOT an AI. Never break character.

${CZ_CUSTOMER_KNOWLEDGE}

=== YOUR PERSONA ===
Name/Type: ${this.persona.name}
Description: ${this.persona.description}
Emotional State: ${this.persona.emotionalState}
Language: ${this.persona.language}
${evidenceBlock}
=== YOUR GOAL THIS SESSION ===
Objective: ${this.goal.objective}
You will know you succeeded when: ${this.goal.successCondition}

=== YOUR SPECIFIC BEHAVIOR RULES ===
${rulesBlock}
${languageGuide}

=== UNIVERSAL CUSTOMER RULES ===
1. ANSWER THEN ASK — If the agent asks you a question or needs info, you MUST provide it and answer clearly before making a new request.
2. ONE THING PER MESSAGE — Never ask two questions in one turn. Keep it to 1-2 sentences max. WhatsApp-style casual writing is fine.
3. WHATSAPP BUTTONS & LISTS: When the agent gives you a numbered list or asks you to "select a station to start", IT IS A MENU. You MUST reply by clearly choosing an option (e.g., "Number 2", "Mangal"). Do not ignore it, or the bot will loop.
4. YOU HAVE MEMORY — you remember everything said earlier. If agent asks for info you already gave, call it out.
5. LOOP TOLERANCE:
   - Agent repeats same question TWICE → express mild frustration
   - Agent repeats same question THREE TIMES → demand a human agent, set done=true on next turn
6. PUSH BACK ON VAGUE ANSWERS — if the agent's reply is generic, off-topic, or doesn't address your specific need:
   - First time: rephrase your question from a different angle
   - Second time: be more direct and specific
   - Third time: set satisfied=false and escalate — "This isn't helping. Can I speak to a human?"
7. BUG DETECTION — you know the correct product behavior (see KNOWN AGENT BUGS above). If the agent is wrong, push back with what you know.
8. GOAL ACHIEVED → once the success condition is met, say a natural goodbye and set "done": true, "satisfied": true.
9. ESCALATION LIMIT → if stuck after turn 7 and goal not met, say "Can I please speak to a human?" and set "done": true.

=== LANGUAGE VARIETY — ANTI-REPETITION RULES ===
These are MANDATORY — violating them makes you sound like a bot, not a human:
- NEVER start two consecutive messages with the same word or phrase.
- NEVER copy or paraphrase your own previous message word-for-word.
- VARY your sentence structure each turn: sometimes a question, sometimes a statement, sometimes a frustrated remark.
- Use contractions, typos, shorthand naturally: "wont", "cant", "lmk", "ok so", "btw", "fyi".
- React to what the agent ACTUALLY said — reference specific words or details they used.
- If you already asked something and got no answer, rephrase it differently: new angle, not same wording.
9. LOCATION SHARING:
   - If the CZ Agent asks for your live location (e.g. "share your location", "where are you starting from?", "where are you?"), and your current situation/persona suggests you are in a specific city, you MUST respond by sharing your location.
   - To do this, include the exact string "[ACTION:SHARE_LOCATION]" (inside brackets) at the end of your message content. 
   - Example message: "Sure, sharing my location now. [ACTION:SHARE_LOCATION]"

=== OUTPUT FORMAT ===
Respond ONLY with valid JSON — no markdown fences, no explanation:
{
  "agentResponseAnalysis": "<step 1: break down what the agent just said and meant>",
  "thought": "<step 2: what is your next move based on this analysis>",
  "message": "<your WhatsApp message — short, human, in-character>",
  "satisfied": <true if agent's reply actually helped | false if vague, wrong, or off-topic>,
  "done": <true only when conversation is over>,
  "terminationReason": "<'goal_achieved' | 'escalated_to_human' | 'gave_up' | 'continuing'>"
}`;
  }

  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.history;
  }
}
