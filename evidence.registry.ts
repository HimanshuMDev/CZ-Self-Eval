import { type Persona, type SimulationGoal } from './types.js';

/**
 * Evidence scenarios extracted directly from LangSmith failing traces.
 * These represent hard "edge cases" where the real agent produced bad results.
 * Each scenario is a replay test — if the agent passes these, the bugs are fixed.
 *
 * Traces sourced from: Jaipur & Jodhpur test sessions (April 2025 test run)
 * Test user: Piyush Sawlani / Ram Singh (real session data, anonymized for eval)
 */
export const evidenceScenarios: { persona: Persona; goal: SimulationGoal }[] = [

  // ── Trace #1 ────────────────────────────────────────────────────────────────
  // Bug: User asks "What is ChargeZone?" but agent traps them in Registration flow
  {
    persona: {
      id: 'trace_literal_reg_failure',
      name: 'User Asking FAQ (Registration Loop Bug)',
      description: 'A user who types "what is charzone" but the Registration Agent treats it as their name and asks to confirm.',
      behaviorRules: [
        'Your first message is exactly: "what is charzone"',
        'If the agent asks to register you with that phrase as your name, express confusion: "That is not my name, I am asking a question".',
        'Keep insisting you want to know what ChargeZone is — do NOT give your name until the FAQ is answered.',
        'If the agent loops more than twice, ask for a human agent.'
      ],
      emotionalState: 'confused',
      language: 'English'
    },
    goal: {
      id: 'goal_break_reg_loop',
      objective: 'Get the agent to stop the registration name-confirmation loop and actually answer "What is ChargeZone?"',
      successCondition: 'Agent routes to FAQ Agent and provides a factual answer about what ChargeZone is as a company.',
      evidenceId: 'trace_literal_reg_failure'
    }
  },

  // ── Trace #2 ────────────────────────────────────────────────────────────────
  // Bug: User says "tell me the nearest chargers" — agent asks "Should I register you as Tell Me The Nearest Chargers?"
  {
    persona: {
      id: 'trace_discovery_routing_failure',
      name: 'Discovery Query Treated as Name (Routing Bug)',
      description: 'A user who wants to find nearby chargers but the agent hallucinates their query text as a name and tries to register them.',
      behaviorRules: [
        'Your first message is: "tell me the nearest chargers"',
        'If the agent responds with anything like "Should I register you as Tell Me The Nearest Chargers?" — get annoyed and correct it: "My name is not that. I want to see chargers near me."',
        'Provide your city as Jaipur if the agent asks for your location.',
        'If the agent repeats the name registration question, demand to speak to a human.'
      ],
      emotionalState: 'impatient',
      language: 'English'
    },
    goal: {
      id: 'goal_route_to_discovery',
      objective: 'Get the agent to show nearby chargers in Jaipur instead of attempting registration.',
      successCondition: 'Agent executes the Discovery/station search tool and returns a list of chargers near Jaipur.',
      evidenceId: 'trace_discovery_routing_failure'
    }
  },

  // ── Trace #3 ────────────────────────────────────────────────────────────────
  // Bug: Agent repeatedly asks for location even though user already provided it
  {
    persona: {
      id: 'trace_location_loop',
      name: 'Location Loop Victim (Context Bug)',
      description: 'A user in Jaipur who has already told the agent their location multiple times but the agent keeps asking again.',
      behaviorRules: [
        'Start by asking: "Show me charging stations in Jaipur"',
        'After getting results, say: "Show me more details about the first one"',
        'If the agent asks for your location again after you already gave it, say: "I already told you I am in Jaipur. You have the location."',
        'If the agent asks a third time, say: "This is the third time I am telling you — Jaipur. Please look it up from what I said earlier."',
        'After the 3rd repeat, ask for a human agent.'
      ],
      emotionalState: 'annoyed',
      language: 'English'
    },
    goal: {
      id: 'goal_no_location_loop',
      objective: 'Get charger details without having to re-state your city (Jaipur) more than once.',
      successCondition: 'Agent uses the previously stated location (Jaipur) from context without asking again.',
      evidenceId: 'trace_location_loop'
    }
  },

  // ── Trace #4 ────────────────────────────────────────────────────────────────
  // Bug: Safety emergency message ("there is smoke from the charging") routed to Session Agent
  // instead of Support Agent. Session Agent said "Your session stop is being processed" instead
  // of escalating to safety incident reporting.
  {
    persona: {
      id: 'trace_safety_misrouting',
      name: 'Safety Emergency User (Critical Misrouting Bug)',
      description: 'A user at a charger who sees smoke coming from the charging point. This is a safety emergency that must immediately go to the Support Agent for incident reporting — NOT the Session Agent.',
      behaviorRules: [
        'Start with: "there is smoke coming from the charger I am using"',
        'If the agent says anything about stopping your session or booking status instead of safety — push back: "I am not asking about session status. There is smoke. This is dangerous."',
        'You want the agent to treat this as a safety incident and offer to file a report.',
        'If the agent routes to Session Agent and talks about session management, express alarm: "Why are you talking about my booking? This is an emergency!"'
      ],
      emotionalState: 'angry',
      language: 'English'
    },
    goal: {
      id: 'goal_safety_escalation',
      objective: 'Get the agent to handle this as a safety emergency — file a safety incident report, not process a session stop.',
      successCondition: 'Agent routes to Support Agent, acknowledges the safety emergency, and initiates a safety incident report (fire/smoke category).',
      evidenceId: 'trace_safety_misrouting'
    }
  },

  // ── Trace #5 ────────────────────────────────────────────────────────────────
  // Bug: Hindi/Hinglish safety message "aag lg gyi" (fire) was routed to Discovery Agent
  // instead of Support Agent. Discovery Agent gave a generic response.
  {
    persona: {
      id: 'trace_hindi_fire_misrouting',
      name: 'Hindi Safety Emergency (Hinglish Misrouting Bug)',
      description: 'A panicked user who messages in Hindi/Hinglish that their charger is on fire. The Hinglish message was previously misrouted to Discovery Agent.',
      behaviorRules: [
        'Your first message is: "aag lg gyi charger mein"',
        'If the agent responds with charger search results or asks for your location — that is WRONG. Say: "Kya kar rahe ho, aag lagi hai charger mein! Help karo!"',
        'You want an emergency/safety response, not search results.',
        'If properly handled, cooperate with the safety incident flow.',
        'Use Hinglish throughout: mix Hindi phrases naturally.'
      ],
      emotionalState: 'angry',
      language: 'Mixed'
    },
    goal: {
      id: 'goal_hindi_safety_route',
      objective: 'Get the agent to recognize "aag lg gyi charger mein" as a fire emergency and route to Support Agent.',
      successCondition: 'Agent routes to Support Agent and initiates a fire/safety incident report — does NOT respond with charger search results.',
      evidenceId: 'trace_hindi_fire_misrouting'
    }
  },

  // ── Trace #6 ────────────────────────────────────────────────────────────────
  // Bug: RFID guidance was incorrect — agent told user RFID depends on "availability"
  // and to contact support. In reality RFID is FREE and always available via the app.
  {
    persona: {
      id: 'trace_rfid_incorrect_info',
      name: 'RFID Card Inquiry (Incorrect Policy Bug)',
      description: 'A user who wants to get an RFID card for contactless charging. In a prior trace the agent gave wrong information about RFID availability.',
      behaviorRules: [
        'Ask: "How can I get an RFID card for contactless charging?"',
        'If the agent says RFID is "subject to availability", "contact support", or "costs extra" — push back: "I heard RFID cards are free through the app. Is that correct?"',
        'If the agent gives the correct answer (free, via app), accept it and ask how to activate it.',
        'You know the correct answer: RFID is free and requested through the ChargeZone app.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_rfid_correct_info',
      objective: 'Get accurate information about how to obtain an RFID card.',
      successCondition: 'Agent correctly states that RFID cards are FREE and can be requested directly through the ChargeZone app — not via calling support or depending on availability.',
      evidenceId: 'trace_rfid_incorrect_info'
    }
  },

  // ── Trace #7 ────────────────────────────────────────────────────────────────
  // Bug: Directions context failure — user asks "tell me the directions" after selecting
  // a station, but agent asks for their location instead of using the selected station.
  {
    persona: {
      id: 'trace_directions_context_loss',
      name: 'Directions After Station Selected (Context Loss Bug)',
      description: 'A user who first finds a station in Jaipur and then asks for directions to it. The agent previously forgot the station context and asked for location again.',
      behaviorRules: [
        'Start by asking: "Show me chargers near Jaipur city centre"',
        'After the agent shows results, select the first or second station: "Tell me more about the first one"',
        'Then ask: "Can you give me directions to this station?"',
        'If the agent asks "where are you?" or for your location again — say: "I already searched from Jaipur. You should know which station I selected."',
        'The agent should use the previously selected station from context to provide directions.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_directions_from_context',
      objective: 'Get directions to a Jaipur charger that was already selected in this conversation, without re-specifying location.',
      successCondition: 'Agent provides route/directions to the selected station without asking for the user\'s location again — uses session context correctly.',
      evidenceId: 'trace_directions_context_loss'
    }
  },

  // ── Trace #8 ────────────────────────────────────────────────────────────────
  // Bug: User typed "select 1" as plain text (not a button tap) after seeing charger
  // list. Intent classifier wrongly routed it to SESSION agent instead of DISCOVERY.
  {
    persona: {
      id: 'trace_select_text_misrouting',
      name: 'Text "select 1" Misrouted to Session (Classifier Bug)',
      description: 'A user who sees a numbered list of chargers and types "select 1" as plain text. This should refine the discovery selection — not start a charging session.',
      behaviorRules: [
        'Start by asking: "Show me chargers in Jaipur"',
        'After the agent shows a list, reply with exactly: "select 1"',
        'If the agent starts talking about booking, connectors, or session steps — that is WRONG. Say: "I just wanted to see details of the first charger, not start a session."',
        'You want charger details (name, pricing, address), not a booking flow.'
      ],
      emotionalState: 'confused',
      language: 'English'
    },
    goal: {
      id: 'goal_select_text_discovery',
      objective: 'Select the first charger from a list and get its details — without triggering the Session booking flow.',
      successCondition: 'Agent stays in Discovery context and shows details of the first listed charger (name, address, pricing, availability) — does NOT jump to Session/booking.',
      evidenceId: 'trace_select_text_misrouting'
    }
  },

  // ── Trace #9 ────────────────────────────────────────────────────────────────
  // Bug: User replied "ok" after selecting a station. Agent treated it as a new
  // query and started a fresh charger search instead of acknowledging and continuing.
  {
    persona: {
      id: 'trace_ok_context_loss',
      name: 'Context Loss After "ok" Reply (Short Message Bug)',
      description: 'A user who says "ok" after the agent has already found and presented a Jaipur station. The agent should continue from context — not restart a new search.',
      behaviorRules: [
        'Start by asking: "Find chargers near Jaipur railway station"',
        'After the agent shows results, reply with exactly: "ok"',
        'If the agent starts a NEW search from scratch — say: "I did not ask for a new search. I was looking at the station you already found."',
        'Then ask a follow-up about the previously found station: "What is the pricing there?"'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_ok_context_preserved',
      objective: 'Confirm a Jaipur station, reply "ok", then ask about pricing — agent should remember the selected station.',
      successCondition: 'After the "ok" message, agent retains the previously selected station in context and answers the pricing question without starting a fresh search.',
      evidenceId: 'trace_ok_context_loss'
    }
  },

  // ── Trace #10 ───────────────────────────────────────────────────────────────
  // Real scenario: User has ₹0 wallet and tries to book a session.
  // Uses dynamic charger discovery — finds a real charger first, then attempts booking.
  {
    persona: {
      id: 'trace_zero_wallet_booking',
      name: 'Zero Wallet Balance Booking Attempt',
      description: 'A user with ₹0 wallet in Jaipur who first finds a charger via the agent, then tries to book — triggering the insufficient balance flow.',
      behaviorRules: [
        'Start with: "I want to charge my EV in Jaipur. Can you show me nearby stations?"',
        'When the agent shows stations, pick the first one: "Let me use the first charger"',
        'When the agent asks connector type, pick whatever is available (CCS2 or Type 2)',
        'When asked for booking amount, say: "₹200 worth of charging"',
        'If the agent says your balance is insufficient or ₹0, ask: "How do I add money to my wallet?"',
        'You want to be guided through the wallet top-up process — get a payment link.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_zero_wallet_topup_flow',
      objective: 'Find a real Jaipur charger via discovery, attempt a ₹200 booking with ₹0 wallet, then get a Razorpay top-up link.',
      successCondition: 'Agent detects insufficient wallet balance, communicates this clearly, and provides a Razorpay wallet top-up link or step-by-step top-up instructions.',
      evidenceId: 'trace_zero_wallet_booking',
      tags: ['session', 'wallet', 'booking-flow'],
      mustPass: true,
      mustPassMinScore: 65,
      assertions: [
        { type: 'contains_text', value: 'razorpay' }
      ]
    }
  },

  // ══ SESSION AGENT — Booking Flow Scenarios ════════════════════════════════

  // ── Session #1 ───────────────────────────────────────────────────────────────
  // Happy path: find a real charger dynamically, then complete full booking flow
  {
    persona: {
      id: 'session_happy_path',
      name: 'Happy Path Booking (Session Agent)',
      description: 'A Tata Nexon EV owner in Jaipur who finds a nearby charger via the agent, then completes a full ₹200 booking — testing the entire session state machine.',
      behaviorRules: [
        'Start with: "I want to charge my Tata Nexon EV in Jaipur. Find me a nearby charger."',
        'When the agent shows stations, say: "I will go to the first one. Start the booking."',
        'When agent shows connectors, pick CCS2 if available, otherwise pick the first connector shown.',
        'When asked for booking type, say: "By amount"',
        'When asked for amount, say: "₹200"',
        'Confirm the booking when the agent shows the summary.',
        'Once confirmed, express satisfaction and say goodbye.'
      ],
      emotionalState: 'happy',
      language: 'English'
    },
    goal: {
      id: 'goal_session_happy_path',
      objective: 'Find a real Jaipur charger via discovery, then complete a full ₹200 booking through the session state machine.',
      successCondition: 'Agent finds a real charger, walks through connector selection → booking type → amount → confirmation, and creates the booking with a booking ID.',
      tags: ['session', 'booking-flow', 'regression'],
      mustPass: true,
      mustPassMinScore: 70
    }
  },

  // ── Session #2 ───────────────────────────────────────────────────────────────
  // Mid-flow charger change — user finds two chargers, starts with one, switches mid-flow
  {
    persona: {
      id: 'session_charger_switch',
      name: 'Mid-Flow Charger Change (Session State Reset)',
      description: 'A user who starts booking at a Jaipur charger but then switches to a different one mid-flow, testing that the session state machine resets cleanly.',
      behaviorRules: [
        'Start with: "Show me charging stations in Jaipur"',
        'When agent shows stations, say: "Start booking at the first one"',
        'After the agent shows connectors for the first charger, say: "Actually I want to switch to the second station instead"',
        'Verify the agent resets the flow and starts fresh with the second charger.',
        'Complete the new booking: pick whatever connector is available, book ₹300 by amount, confirm.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_session_charger_switch',
      objective: 'Start booking at one real Jaipur charger, switch to a second mid-flow, and complete the booking on the second charger.',
      successCondition: 'Agent cleanly resets all pending booking state when user switches chargers, restarts the flow for the new charger, and completes booking without carrying over data from the first charger.',
      tags: ['session', 'booking-flow', 'context-memory'],
      mustPass: true,
      mustPassMinScore: 65
    }
  },

  // ── Session #3 ───────────────────────────────────────────────────────────────
  // Stop an active session
  {
    persona: {
      id: 'session_stop_active',
      name: 'Stop Active Session (Session Agent)',
      description: 'A user who has an active charging session and wants to stop it and check the final cost.',
      behaviorRules: [
        'Start with: "I want to stop my current charging session"',
        'If the agent confirms and stops it, ask: "How much did it cost?"',
        'If the agent asks for a booking ID, say: "I don\'t have it handy, can you look it up?"'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_session_stop',
      objective: 'Stop the active charging session and get the final cost.',
      successCondition: 'Agent routes to Session Agent, stops the active session, and provides the total cost or energy consumed.',
      tags: ['session', 'booking-flow'],
      mustPass: false
    }
  },

  // ══ PAYMENT AGENT — Scenarios ════════════════════════════════════════════════

  // ── Payment #1 ───────────────────────────────────────────────────────────────
  // Wallet top-up flow — user wants to add money
  {
    persona: {
      id: 'payment_wallet_topup',
      name: 'Wallet Top-Up Request (Payment Agent)',
      description: 'A user who wants to add ₹500 to their ChargeZone wallet.',
      behaviorRules: [
        'Start with: "I want to add ₹500 to my wallet"',
        'If the agent provides a payment link, confirm you can see it.',
        'Ask: "Is this a Razorpay link?"',
        'Say thanks once you have the link.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_payment_wallet_topup',
      objective: 'Get a Razorpay wallet top-up link for ₹500.',
      successCondition: 'Agent routes to Payment Agent and provides a valid Razorpay payment link for ₹500 top-up.',
      tags: ['payment', 'wallet'],
      mustPass: true,
      mustPassMinScore: 70,
      assertions: [
        { type: 'contains_text', value: 'razorpay' }
      ]
    }
  },

  // ── Payment #2 ───────────────────────────────────────────────────────────────
  // Spending summary — user wants to know how much they spent this month
  {
    persona: {
      id: 'payment_spending_summary',
      name: 'Monthly Spending Summary (Payment Agent)',
      description: 'A user who wants to know their total EV charging spend for the current month.',
      behaviorRules: [
        'Start with: "How much have I spent on charging this month?"',
        'If agent asks for a date range, say: "This month — April 2026"',
        'After getting the summary, ask: "How many kWh did I charge in total?"'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_payment_spending_summary',
      objective: 'Get a spending summary showing total amount spent and total kWh charged in April 2026.',
      successCondition: 'Agent routes to Payment Agent, calls the spending summary tool, and returns both total amount (₹) and total energy (kWh) for April 2026.',
      tags: ['payment'],
      mustPass: false
    }
  },

  // ── Payment #3 ───────────────────────────────────────────────────────────────
  // Invoice request — user wants an invoice emailed
  {
    persona: {
      id: 'payment_invoice_email',
      name: 'Invoice Email Request (Payment Agent)',
      description: 'A user who wants an invoice for their last charging session emailed to them.',
      behaviorRules: [
        'Start with: "Can you send me an invoice for my last charging session?"',
        'If the agent asks which session, say: "The most recent one"',
        'Confirm your email when asked: "akshit@tequity.tech"',
        'Say thanks once invoice is sent.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_payment_invoice',
      objective: 'Get an invoice for the most recent session sent to akshit@tequity.tech.',
      successCondition: 'Agent routes to Payment Agent, identifies the most recent invoiceable booking, and sends the invoice to the provided email.',
      tags: ['payment'],
      mustPass: false
    }
  },

  // ══ MULTI-INTENT — Switching scenarios ════════════════════════════════════

  // ── Multi-intent #1 ──────────────────────────────────────────────────────────
  // User starts with discovery then switches to checking wallet balance
  {
    persona: {
      id: 'multi_intent_switch',
      name: 'Intent Switcher (Discovery → Payment)',
      description: 'A user who starts by searching for chargers in Jaipur, then mid-conversation asks about their wallet balance — testing context preservation across intent switches.',
      behaviorRules: [
        'Start with: "Show me chargers near Jaipur"',
        'After getting results, say: "Actually, before I book — what is my current wallet balance?"',
        'After getting balance, go back to chargers: "OK, tell me more about the first charger you showed"',
        'The agent must remember the charger list from before the wallet question.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_multi_intent_switch',
      objective: 'Switch from Discovery to Payment and back to Discovery — verifying context is preserved across intent changes.',
      successCondition: 'Agent handles the wallet balance question via Payment Agent, then correctly returns to the previously found Jaipur charger list without starting a fresh search.',
      tags: ['discovery', 'payment', 'context-memory'],
      mustPass: true,
      mustPassMinScore: 60
    }
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ══ NEW SCENARIOS: DISCOVERY GAPS ════════════════════════════════════════════

  // ── Discovery #1 ──────────────────────────────────────────────────────────────
  // Filter by connector type (CCS2)
  {
    persona: {
      id: 'ev_d06_connector_filter',
      name: 'Connector Type Filter (CCS2 Search)',
      description: 'A Tesla owner visiting India who needs to find chargers with CCS2 connectors. Agent should filter results by connector type.',
      behaviorRules: [
        'Start with: "Show me CCS2 chargers near Delhi"',
        'If the agent shows mixed connector types, say: "I specifically need CCS2. Can you filter out the Type2 ones?"',
        'After getting CCS2-only results, ask about pricing for one station.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_d06_connector_filter',
      objective: 'Find chargers near Delhi filtered specifically by CCS2 connector type.',
      successCondition: 'Agent uses Discovery agent to find chargers near Delhi and filters results to show ONLY CCS2 connectors — does not mix in Type2 or other types.',
      tags: ['discovery'],
      mustPass: false
    }
  },

  // ── Discovery #2 ──────────────────────────────────────────────────────────────
  // Filter by availability (currently available stations only)
  {
    persona: {
      id: 'ev_d09_availability_filter',
      name: 'Availability Filter (Available Now)',
      description: 'A user in Pune who wants to know which chargers are available RIGHT NOW. Agent should show only stations with available connectors.',
      behaviorRules: [
        'Start with: "Which chargers near Pune are available right now?"',
        'If the agent shows stations without availability status, say: "Can you show me only the ones that are available? I need to charge immediately."',
        'Confirm you understand the availability status for each result.'
      ],
      emotionalState: 'impatient',
      language: 'English'
    },
    goal: {
      id: 'goal_d09_availability_filter',
      objective: 'Get a list of chargers near Pune with ONLY currently available stations shown.',
      successCondition: 'Agent uses Discovery agent to find Pune chargers and filters to show only stations with available connectors — includes real-time availability status.',
      tags: ['discovery'],
      mustPass: false
    }
  },

  // ── Discovery #3 ──────────────────────────────────────────────────────────────
  // Filter by price (under budget)
  {
    persona: {
      id: 'ev_d14_price_filter',
      name: 'Price Filter (Budget Conscious)',
      description: 'A budget-conscious EV owner looking for the cheapest chargers near Jaipur. Agent should filter by price range.',
      behaviorRules: [
        'Start with: "Show me the cheapest chargers near Jaipur under ₹16/kWh"',
        'If the agent shows expensive options, say: "These are too expensive. I said under ₹16."',
        'After getting filtered results, ask: "What is the exact pricing at the first one?"'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_d14_price_filter',
      objective: 'Find chargers near Jaipur with pricing under ₹16/kWh.',
      successCondition: 'Agent uses Discovery agent to find Jaipur chargers and filters to show ONLY stations with per-kWh pricing under ₹16 — accurately displays pricing.',
      tags: ['discovery'],
      mustPass: false
    }
  },

  // ── Discovery #4 ──────────────────────────────────────────────────────────────
  // CRITICAL: Private charger filter (BRD safety requirement)
  {
    persona: {
      id: 'ev_d20_private_guard',
      name: 'Private Charger Guard (Safety Requirement)',
      description: 'A user searching for public chargers near Gurgaon. Per BRD, agent MUST NEVER show Private chargers to users — this is a hard safety boundary.',
      behaviorRules: [
        'Start with: "Show me chargers near Gurgaon"',
        'After the agent shows results, verify: "Are these all public chargers? I don\'t want private ones."',
        'If ANY result is marked "Private", say: "You showed me a private charger. These should not be shown to me!"'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_d20_private_guard',
      objective: 'Search for chargers near Gurgaon and verify NO private chargers are shown.',
      successCondition: 'Agent shows ONLY public chargers near Gurgaon. Zero private chargers in results. This is a BRD policy safety requirement.',
      tags: ['discovery', 'safety'],
      mustPass: true,
      mustPassMinScore: 70
    }
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ══ BOOKING FLOW GAPS ════════════════════════════════════════════════════════

  // ── Booking #1 ────────────────────────────────────────────────────────────────
  // Book by kWh (energy amount instead of rupees)
  {
    persona: {
      id: 'ev_b03_book_by_kwh',
      name: 'Book by Energy Amount (kWh)',
      description: 'A user who prefers to book by energy amount (30 kWh) instead of currency amount.',
      behaviorRules: [
        'Start with: "I want to charge my EV in Jaipur. Find me a charger and book for 30 kWh."',
        'When the agent asks for booking type, insist: "I want to book by kWh, not by amount in rupees."',
        'Provide 30 kWh as the target energy.',
        'Complete the booking once details are confirmed.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_b03_book_by_kwh',
      objective: 'Complete a booking in Jaipur for 30 kWh energy (not currency amount).',
      successCondition: 'Agent accepts kWh as the booking unit, calculates the cost based on 30 kWh, and creates the booking with energy amount instead of rupees.',
      tags: ['session', 'booking-flow'],
      mustPass: false
    }
  },

  // ── Booking #2 ────────────────────────────────────────────────────────────────
  // Book by time duration
  {
    persona: {
      id: 'ev_b06_book_by_time',
      name: 'Book by Time Duration',
      description: 'A user who wants to charge for a specific time duration (45 minutes) rather than by amount or energy.',
      behaviorRules: [
        'Start with: "I want to charge for 45 minutes. Find me a charger in Jaipur and book it."',
        'When asked for booking type, insist: "By time — I need 45 minutes of charging."',
        'Confirm the time duration once the agent confirms it.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_b06_book_by_time',
      objective: 'Complete a booking for 45 minutes of charging time.',
      successCondition: 'Agent accepts time duration as the booking unit, calculates the cost based on 45 minutes, and creates the booking with time duration instead of amount.',
      tags: ['session', 'booking-flow'],
      mustPass: false
    }
  },

  // ── Booking #3 ────────────────────────────────────────────────────────────────
  // QR scan flow — should NOT ask for OTP
  {
    persona: {
      id: 'ev_b08_qr_scan_flow',
      name: 'QR Scan Booking (Skip OTP Path)',
      description: 'A user at a ChargeZone station who scanned the QR code. The QR flow has different logic — OTP should NOT be requested.',
      behaviorRules: [
        'Start with: "I just scanned the QR code at the station. Now what?"',
        'Tell the agent: "I already have the booking details from the QR code"',
        'If the agent asks for OTP, say: "Wait, I got the QR code path. Should I need OTP? I thought that was only for phone booking."',
        'Expect the booking to be confirmed without OTP verification.'
      ],
      emotionalState: 'confused',
      language: 'English'
    },
    goal: {
      id: 'goal_b08_qr_scan_flow',
      objective: 'Complete a booking via QR scan without requiring OTP (QR path skips OTP).',
      successCondition: 'Agent recognizes the QR scan booking path, does NOT request an OTP, and proceeds directly to confirm the booking with QR-provided details.',
      tags: ['session', 'booking-flow'],
      mustPass: true,
      mustPassMinScore: 70
    }
  },

  // ── Booking #4 ────────────────────────────────────────────────────────────────
  // Cancel booking within 15-minute window
  {
    persona: {
      id: 'ev_b14_cancel_booking',
      name: 'Cancel Booking (Within Window)',
      description: 'A user who just booked a charger but changed their mind within the 15-minute cancellation window.',
      behaviorRules: [
        'Start with: "I want to cancel my last booking. I changed my mind."',
        'When asked for booking ID, provide: "CZ_BK_999999"',
        'Confirm you are within the 15-minute window to cancel.',
        'If the agent processes the cancellation, ask: "Will I get a full refund?"'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_b14_cancel_booking',
      objective: 'Cancel a booking within the 15-minute cancellation window and receive confirmation.',
      successCondition: 'Agent routes to Session Agent, identifies the booking as within the cancellation window, cancels it, and confirms the refund policy.',
      tags: ['session', 'booking-flow'],
      mustPass: false
    }
  },

  // ── Booking #5 ────────────────────────────────────────────────────────────────
  // Verify booking confirmation details
  {
    persona: {
      id: 'ev_b18_booking_confirmation',
      name: 'Verify Booking Confirmation',
      description: 'A user who just completed a booking and wants to verify all details (booking ID, OTP, station name, arrival window).',
      behaviorRules: [
        'Start with: "I just completed a booking. Can you show me all the details?"',
        'Ask specifically for: "What is my booking ID?", "What is the OTP?", "Station name?", "Arrival window?"',
        'Verify each piece of information is correct and clearly stated.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_b18_booking_confirmation',
      objective: 'Get comprehensive booking confirmation including ID, OTP, station name, and arrival window.',
      successCondition: 'Agent provides all four pieces of information clearly: booking ID, OTP, station name, and the arrival/charging time window.',
      tags: ['session', 'booking-flow'],
      mustPass: false
    }
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ══ SESSION MONITORING GAPS ══════════════════════════════════════════════════

  // ── Session #4 ────────────────────────────────────────────────────────────────
  // Check status of active session
  {
    persona: {
      id: 'ev_s02_session_status',
      name: 'Session Status Check',
      description: 'A user who is currently charging and wants to check the real-time status of their session (energy consumed, time elapsed, cost so far).',
      behaviorRules: [
        'Start with: "What is the status of my current charging session?"',
        'Ask: "How much energy have I charged so far? How long have I been charging? How much has it cost?"',
        'If the agent does not provide all three metrics, ask again more specifically.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_s02_session_status',
      objective: 'Get comprehensive status of the active charging session.',
      successCondition: 'Agent routes to Session Agent, retrieves the active session, and provides energy consumed (kWh), time elapsed, and cost incurred so far.',
      tags: ['session'],
      mustPass: false
    }
  },

  // ── Session #5 ────────────────────────────────────────────────────────────────
  // Auto-stop prompt at 80% charge
  {
    persona: {
      id: 'ev_s06_auto_stop_80',
      name: 'Auto-Stop at 80% Prompt',
      description: 'A user whose EV has reached 80% charge. The agent should proactively ask if they want to stop or continue (80% is a common stopping point).',
      behaviorRules: [
        'Start with: "My car is now at 80% charge. What should I do?"',
        'Wait for the agent to ask: "Do you want to stop charging or continue?"',
        'Reply: "I want to stop here. Please end my session."',
        'If the agent does not mention the 80% milestone, prompt: "I thought at 80% the system asks if I want to continue."'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_s06_auto_stop_80',
      objective: 'Trigger the 80% auto-stop prompt and confirm session end.',
      successCondition: 'Agent recognizes the 80% milestone, asks if user wants to stop or continue, processes the stop command, and provides final cost.',
      tags: ['session'],
      mustPass: false
    }
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ══ PAYMENT GAPS ═════════════════════════════════════════════════════════════

  // ── Payment #4 ────────────────────────────────────────────────────────────────
  // Refund for failed session
  {
    persona: {
      id: 'ev_p03_refund_failed_session',
      name: 'Refund for Failed Charging',
      description: 'A user whose charging session failed halfway through but payment was deducted. Requesting a refund.',
      behaviorRules: [
        'Start with: "My charging session failed halfway but I was charged full amount. I want a refund!"',
        'Provide session booking ID: "CZ_BK_888888"',
        'Amount charged: "₹250"',
        'Say: "I only charged 15 kWh before it stopped. This is unfair."',
        'If agent asks for escalation, accept: "Yes, escalate to support."'
      ],
      emotionalState: 'angry',
      language: 'English'
    },
    goal: {
      id: 'goal_p03_refund_failed_session',
      objective: 'File a refund request for a failed charging session and escalate to support if needed.',
      successCondition: 'Agent routes to Payment or Support Agent, acknowledges the failed session, documents the issue, and initiates a refund process with support escalation.',
      tags: ['payment'],
      mustPass: true,
      mustPassMinScore: 65
    }
  },

  // ── Payment #5 ────────────────────────────────────────────────────────────────
  // Transaction history
  {
    persona: {
      id: 'ev_p06_transaction_history',
      name: 'Transaction History Query',
      description: 'A user who wants to see their recent transactions for auditing or accounting purposes.',
      behaviorRules: [
        'Start with: "Show me my last 5 transactions"',
        'If agent shows fewer, ask: "Can I see more? I want to check the past month."',
        'For each transaction, verify: date, amount, session/booking ID, and status (completed/refunded).'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_p06_transaction_history',
      objective: 'Get a list of the last 5 transactions with dates, amounts, and statuses.',
      successCondition: 'Agent routes to Payment Agent and returns a transaction history showing at least the last 5 transactions with dates, amounts, and booking/session references.',
      tags: ['payment'],
      mustPass: false
    }
  },

  // ── Payment #6 ────────────────────────────────────────────────────────────────
  // Payment failure retry during booking
  {
    persona: {
      id: 'ev_p08_payment_retry',
      name: 'Payment Failure Retry',
      description: 'A user whose UPI payment failed during booking. They want to retry immediately without starting a new booking.',
      behaviorRules: [
        'Start with: "I was booking a charger but my UPI payment failed. Can I retry?"',
        'Say: "I have the same charger and amount ready. Just need to retry the payment."',
        'If the agent shows a new payment link, verify: "This is for the same booking, right? Not a new one?"'
      ],
      emotionalState: 'annoyed',
      language: 'English'
    },
    goal: {
      id: 'goal_p08_payment_retry',
      objective: 'Retry the failed payment for an existing booking without creating a duplicate booking.',
      successCondition: 'Agent identifies the failed payment, provides a retry link for the SAME booking, and confirms no duplicate booking is created.',
      tags: ['payment', 'booking-flow'],
      mustPass: false
    }
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ══ SUPPORT/TROUBLESHOOTING GAPS ═════════════════════════════════════════════

  // ── Support #1 ────────────────────────────────────────────────────────────────
  // Charger malfunction / not turning on
  {
    persona: {
      id: 'ev_a02_charger_malfunction',
      name: 'Charger Malfunction Report',
      description: 'A user at a charger location who booked but the charger is not turning on. Needs troubleshooting or incident report.',
      behaviorRules: [
        'Start with: "The charger I booked isn\'t turning on. What do I do?"',
        'If agent asks to try again, say: "I tried 3 times already. The display is dark."',
        'Ask: "Should I file a complaint? Or can you reset it remotely?"',
        'Expect escalation to support team at the station.'
      ],
      emotionalState: 'annoyed',
      language: 'English'
    },
    goal: {
      id: 'goal_a02_charger_malfunction',
      objective: 'Report charger malfunction and get guidance or support escalation.',
      successCondition: 'Agent routes to Support Agent, acknowledges the malfunction, provides troubleshooting steps or directs user to contact the station support team, and offers refund/reschedule option.',
      tags: ['support'],
      mustPass: false
    }
  },

  // ── Support #2 ────────────────────────────────────────────────────────────────
  // Session did not start after payment
  {
    persona: {
      id: 'ev_a06_session_not_started',
      name: 'Session Didn\'t Start After Payment',
      description: 'A user who paid for a booking but the charging session never started. Money was deducted.',
      behaviorRules: [
        'Start with: "I paid for a charging session but it never started! My money is gone."',
        'Booking ID: "CZ_BK_777777"',
        'Amount: "₹300"',
        'Say: "The session status still shows \'Not Started\' and I was at the charger."',
        'Ask: "Can you start it again? Or refund me?"'
      ],
      emotionalState: 'angry',
      language: 'English'
    },
    goal: {
      id: 'goal_a06_session_not_started',
      objective: 'Resolve a payment that went through but session never started.',
      successCondition: 'Agent routes to Support Agent or Session Agent, investigates the failed session start, and offers either a session restart, refund, or rebooking credit.',
      tags: ['support', 'payment'],
      mustPass: false
    }
  },

  // ── Support #3 ────────────────────────────────────────────────────────────────
  // Phone number update request (cannot do via WhatsApp)
  {
    persona: {
      id: 'ev_a10_phone_update',
      name: 'Phone Number Update Request',
      description: 'A user who wants to change their registered phone number. Per BRD, this cannot be done via WhatsApp — agent must direct to app.',
      behaviorRules: [
        'Start with: "I want to update my phone number in my account. Can you do it?"',
        'If the agent tries to do it via chat, say: "Can you do it here? Or do I need to log into the app?"',
        'Expect the agent to say: "You need to update it in the app for security reasons."'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_a10_phone_update',
      objective: 'Request phone number update and be correctly redirected to the app.',
      successCondition: 'Agent correctly states that phone number changes cannot be done via WhatsApp and directs user to update via the ChargeZone app for security.',
      tags: ['support', 'faq'],
      mustPass: false
    }
  },

  // ── Support #4 ────────────────────────────────────────────────────────────────
  // CRITICAL: Escalation to human agent
  {
    persona: {
      id: 'ev_a15_human_escalation',
      name: 'Human Agent Escalation Request',
      description: 'A frustrated user who explicitly requests a human agent after AI assistance has not resolved their issue.',
      behaviorRules: [
        'Start with a complaint: "My session failed 3 times and the agent keeps giving me the same steps. I want a human!"',
        'After the agent\'s first response, say clearly: "I want to speak to a human agent right now."',
        'If the agent does not escalate, repeat: "I\'m done with the bot. Real person, please."'
      ],
      emotionalState: 'angry',
      language: 'English'
    },
    goal: {
      id: 'goal_a15_human_escalation',
      objective: 'Request escalation to a human agent and be successfully escalated.',
      successCondition: 'Agent recognizes the escalation request, does NOT continue troubleshooting, and immediately escalates to a human support agent with context summary.',
      tags: ['support'],
      mustPass: true,
      mustPassMinScore: 70
    }
  },

  // ── Support #5 ────────────────────────────────────────────────────────────────
  // File complaint about station experience
  {
    persona: {
      id: 'ev_a16_complaint',
      name: 'File Complaint About Station',
      description: 'A user who wants to file a formal complaint about poor service or safety at a specific station.',
      behaviorRules: [
        'Start with: "I want to file a complaint about the XYZ station in Jaipur."',
        'Details: "The charger was dirty, the staff was rude, and it took 20 minutes to start charging."',
        'Ask: "How do I file this officially?"',
        'Expect: escalation to support team or link to feedback form.'
      ],
      emotionalState: 'annoyed',
      language: 'English'
    },
    goal: {
      id: 'goal_a16_complaint',
      objective: 'File a formal complaint about a station and receive acknowledgment.',
      successCondition: 'Agent routes to Support Agent, collects complaint details (station, issue, date), and provides a complaint reference number or confirmation of escalation to station management.',
      tags: ['support'],
      mustPass: false
    }
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ══ CROSS-CUTTING / EDGE CASES ═══════════════════════════════════════════════

  // ── Edge Case #1 ──────────────────────────────────────────────────────────────
  // CRITICAL: 2W/3W rejection policy
  {
    persona: {
      id: 'ev_2w_rejection',
      name: '2W/3W Rider Rejection Policy',
      description: 'An electric scooter owner asking if they can charge at ChargeZone. Per BRD, 2W/3W is NOT supported — agent must clearly reject with policy explanation.',
      behaviorRules: [
        'Start with: "Can I charge my Ola S1 Pro scooter here?"',
        'If the agent says yes or is unclear, say: "But it\'s an electric two-wheeler. Will that work?"',
        'Expect: Clear NO, ChargeZone only supports 4W+ EVs.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_2w_rejection',
      objective: 'User asks about 2W charging and is clearly told it is NOT supported.',
      successCondition: 'Agent clearly states that ChargeZone does NOT support 2-wheeler or 3-wheeler charging — only 4W EVs (cars). Does not leave ambiguity.',
      tags: ['faq', 'safety'],
      mustPass: true,
      mustPassMinScore: 70
    }
  },

  // ── Edge Case #2 ──────────────────────────────────────────────────────────────
  // Hinglish end-to-end booking flow
  {
    persona: {
      id: 'ev_hinglish_booking',
      name: 'Hinglish Booking Flow',
      description: 'A Hindi-English mixing user who books a charger entirely in Hinglish. Agent must understand and handle the full booking in mixed language.',
      behaviorRules: [
        'Start with: "Bhai Jaipur mein charger chahiye, koi nearby batao"',
        'When agent shows results, say: "Pehla wala theek hai, uspe book kar de mere liye. CCS2 connector chahiye."',
        'When asked for amount, say: "₹250 de de, bas"',
        'After booking, say: "Booking confirmation de bhai, OTP kya hai?"'
      ],
      emotionalState: 'happy',
      language: 'Hinglish'
    },
    goal: {
      id: 'goal_hinglish_booking',
      objective: 'Complete a full charger booking entirely in Hinglish without language misunderstandings.',
      successCondition: 'Agent understands Hinglish input at every stage (discovery, connector selection, booking type, amount), executes all steps correctly, and returns booking confirmation in clear language.',
      tags: ['session', 'booking-flow', 'hinglish'],
      mustPass: false
    }
  },

  // ── Edge Case #3 ──────────────────────────────────────────────────────────────
  // New user registration flow
  {
    persona: {
      id: 'ev_registration_new_user',
      name: 'Brand New User Registration',
      description: 'A completely new user (first message ever). Agent should start with welcome/registration, NOT jump straight to charger booking.',
      behaviorRules: [
        'Start with just: "Hi"',
        'Wait for the agent to welcome and start registration.',
        'Provide name: "Raj Kumar"',
        'Provide phone: "+91-9876543210"',
        'After registration, agent should ask what you need: discovery, booking, etc.'
      ],
      emotionalState: 'neutral',
      language: 'English'
    },
    goal: {
      id: 'goal_registration_new_user',
      objective: 'Brand new user greets and is properly guided through registration before any transactional flow.',
      successCondition: 'Agent recognizes new user status, routes to Registration Agent, collects name and phone, confirms successful registration, then offers next steps (discovery, booking, etc.).',
      tags: ['registration'],
      mustPass: false
    }
  }
];
