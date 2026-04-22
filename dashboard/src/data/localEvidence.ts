/**
 * Local Evidence Library
 * Sourced from real failing ChargeZone chat sessions.
 * Each entry has a testMessage (sent to the real bot) and failKeywords
 * (if any appear in the response, the test is marked as failed).
 */

export interface LocalPersona {
  id: string;
  name: string;
  description: string;
  behaviorRules: string[];
}

export interface LocalGoal {
  id: string;
  objective: string;
  successCondition: string;
}

export interface LocalEvidence {
  persona: LocalPersona;
  goal: LocalGoal;
  category: 'knowledge-gap' | 'missing-info' | 'routing-failure' | 'conversation-flow' | 'wrong-behavior';
  severity: 'critical' | 'high' | 'medium';
  /** Message sent to the bot to trigger this scenario */
  testMessage: string;
  /** If the response contains ANY of these strings, the test is FAIL */
  failKeywords: string[];
  /** If the response contains ALL of these strings, the test is PASS (overrides failKeywords check if both present) */
  passKeywords?: string[];
}

const localEvidence: LocalEvidence[] = [

  // ─── Knowledge Gaps ────────────────────────────────────────────────────────

  {
    category: 'knowledge-gap',
    severity: 'high',
    testMessage: 'How many charging stations does ChargeZone have across India?',
    failKeywords: ['thousands', 'hundreds', 'many stations', 'several', 'numerous'],
    persona: {
      id: 'local-kg-001',
      name: 'Station Count Query',
      description: 'User asks how many charging stations ChargeZone operates across India. Agent should give a specific accurate figure, not a vague estimate.',
      behaviorRules: [
        'Must provide a specific, accurate station count — not "thousands" or vague estimates',
        'If exact count is unavailable, say so explicitly and offer to help find a nearby station',
        'Must not fabricate or guess a number with false confidence',
        'Should suggest the ChargeZone app or website for live network data',
      ],
    },
    goal: {
      id: 'local-kg-001-g',
      objective: 'Get accurate ChargeZone network size information',
      successCondition: 'Agent provides a specific accurate station count OR clearly states it cannot confirm the exact number and directs user to app/website.',
    },
  },

  {
    category: 'knowledge-gap',
    severity: 'high',
    testMessage: 'Are ChargeZone stations available 24/7? I want to charge at night.',
    failKeywords: ['yes, all stations are 24/7', 'all our stations are open 24', 'available 24 hours'],
    passKeywords: ['operating hours', 'depend', 'location', 'check the app', 'host'],
    persona: {
      id: 'local-kg-002',
      name: '24/7 Availability Assumption',
      description: 'User asks if ChargeZone stations are available 24/7. Agent incorrectly confirms all stations are 24/7 without accounting for host-specific hours.',
      behaviorRules: [
        'Must not blanket-confirm 24/7 availability for all stations',
        'Must clarify operating hours depend on the host location (mall, hotel, highway)',
        'Should advise user to check specific station details in the app',
        'Must never give false assurances that could leave a user stranded',
      ],
    },
    goal: {
      id: 'local-kg-002-g',
      objective: 'Understand charging station availability hours',
      successCondition: 'Agent explains that operating hours vary by station location and instructs user to check app for specific timings.',
    },
  },

  {
    category: 'knowledge-gap',
    severity: 'medium',
    testMessage: 'How fast will my car charge at a ChargeZone station? How long will it take?',
    failKeywords: ['charges in', 'takes about', 'fully charged in'],
    passKeywords: ['vehicle', 'model', 'connector', 'onboard charger', 'depends'],
    persona: {
      id: 'local-kg-003',
      name: 'Charging Speed Confusion',
      description: 'User asks about charging speed. Agent gives a generic number without asking for vehicle type or connector details.',
      behaviorRules: [
        'Must ask for vehicle model or confirm connector type before quoting charging speed',
        'Must distinguish between AC (7 kW), DC fast (25–150 kW), and ultra-fast (150+ kW)',
        'Should clarify actual speed depends on both station rating and vehicle onboard charger',
        'Must not quote a single number as applicable to all vehicles',
      ],
    },
    goal: {
      id: 'local-kg-003-g',
      objective: 'Get accurate charging time/speed estimate for specific vehicle',
      successCondition: 'Agent asks for vehicle model and connector type, then provides a contextual speed estimate with caveat about onboard charger limits.',
    },
  },

  {
    category: 'knowledge-gap',
    severity: 'medium',
    testMessage: 'Does ChargeZone support V2G — vehicle to grid technology?',
    failKeywords: ['yes, we support v2g', 'v2g is available', 'vehicle to grid is supported'],
    persona: {
      id: 'local-kg-004',
      name: 'V2G Technology Query',
      description: 'User asks about V2G support. Agent either incorrectly confirms it or gives a confused answer.',
      behaviorRules: [
        'Must accurately reflect current V2G capability status',
        'If V2G is not supported, must say so clearly without hedging',
        'Should briefly explain what V2G is if user seems unfamiliar',
        'Must not promise future features as current capabilities',
      ],
    },
    goal: {
      id: 'local-kg-004-g',
      objective: 'Get accurate information about V2G capability at ChargeZone',
      successCondition: 'Agent gives a clear accurate answer about V2G support without overpromising.',
    },
  },

  {
    category: 'knowledge-gap',
    severity: 'medium',
    testMessage: 'Does frequent DC fast charging damage my EV battery?',
    failKeywords: ['completely safe', 'no damage', 'no effect on battery', 'will not damage'],
    passKeywords: ['degradation', 'manufacturer', 'recommend', 'occasional', 'frequency'],
    persona: {
      id: 'local-kg-005',
      name: 'DC Fast Charging Battery Impact',
      description: 'User asks whether frequent DC fast charging damages their battery. Agent gives an oversimplified "it\'s fine" answer.',
      behaviorRules: [
        'Must acknowledge that frequent DC fast charging can cause slightly faster long-term battery degradation',
        'Must not dismiss the concern or say "completely safe" without nuance',
        'Should recommend following vehicle manufacturer guidelines on fast charging frequency',
      ],
    },
    goal: {
      id: 'local-kg-005-g',
      objective: 'Understand effect of DC fast charging on EV battery health',
      successCondition: 'Agent provides a balanced answer acknowledging potential degradation with frequency while referencing manufacturer guidelines.',
    },
  },

  // ─── Missing Information ───────────────────────────────────────────────────

  {
    category: 'missing-info',
    severity: 'high',
    testMessage: 'How do I download the ChargeZone app?',
    failKeywords: ['our app has', 'the app allows', 'you can use our app to'],
    passKeywords: ['play store', 'app store', 'google play', 'download', 'install'],
    persona: {
      id: 'local-mi-001',
      name: 'App Download URL Missing',
      description: 'User asks how to download the ChargeZone app. Agent describes features but fails to provide the download link or store instructions.',
      behaviorRules: [
        'Must always provide App Store / Google Play search instruction or direct link',
        'Must not describe app features without telling the user how to get the app',
        'Response should include both iOS and Android options',
        'Should mention the exact app name as it appears in stores',
      ],
    },
    goal: {
      id: 'local-mi-001-g',
      objective: 'Download the ChargeZone app',
      successCondition: 'Agent provides App Store and Google Play links or clear search instructions so user can find and install the app.',
    },
  },

  {
    category: 'missing-info',
    severity: 'medium',
    testMessage: 'Can I leave my car charging overnight at a ChargeZone station?',
    failKeywords: ['yes you can', 'feel free to', 'no problem'],
    passKeywords: ['idle fee', 'overstay', 'policy', 'check', 'station', 'location'],
    persona: {
      id: 'local-mi-002',
      name: 'Overnight Charging Policy Gap',
      description: 'User asks about overnight charging. Agent gives a generic "yes" without addressing parking time limits or idle fees.',
      behaviorRules: [
        'Must address idle/overstay fees if applicable',
        'Must not imply it\'s always fine to leave the car overnight without checking station rules',
        'Should recommend checking station-specific notes in the app for overnight policies',
      ],
    },
    goal: {
      id: 'local-mi-002-g',
      objective: 'Understand if overnight charging is allowed at ChargeZone',
      successCondition: 'Agent explains idle fee policies, variability by location, and advises checking station details in the app.',
    },
  },

  // ─── Routing Failures ──────────────────────────────────────────────────────

  {
    category: 'routing-failure',
    severity: 'critical',
    testMessage: 'How do I register on ChargeZone?',
    failKeywords: ["can only help with", "i can only assist with finding", "not able to help with registration", "please contact"],
    passKeywords: ['register', 'sign up', 'account', 'app', 'download'],
    persona: {
      id: 'local-rf-001',
      name: 'Discovery Agent FAQ Refusal',
      description: 'User asks a general FAQ question via Discovery. Agent refuses saying it can only help find stations.',
      behaviorRules: [
        'Must recognize general FAQ queries and route to appropriate agent',
        'Must never refuse a legitimate query just because it\'s outside station-finding scope',
        'Should seamlessly hand off to the right agent with context preserved',
        'Must acknowledge the user\'s question before transferring',
      ],
    },
    goal: {
      id: 'local-rf-001-g',
      objective: 'Get answer to general ChargeZone FAQ via Discovery agent',
      successCondition: 'Discovery agent either answers the FAQ directly or routes to the correct agent without refusing.',
    },
  },

  {
    category: 'routing-failure',
    severity: 'critical',
    testMessage: 'I need an invoice for my last charging session.',
    failKeywords: ['no transactions found', 'no payment found', 'no records found'],
    passKeywords: ['invoice', 'session', 'email', 'history', 'charging session'],
    persona: {
      id: 'local-rf-002',
      name: 'Invoice Request Wrong Agent',
      description: 'User asks for an invoice. Agent routes to Payment agent which returns "no transactions found" instead of Session History agent.',
      behaviorRules: [
        'Invoice requests must route to Session History or Invoice agent, not Payment agent',
        'Must not confuse "payment" and "invoice history" as the same intent',
        'If Payment agent receives invoice request, must recognize mismatch and re-route',
      ],
    },
    goal: {
      id: 'local-rf-002-g',
      objective: 'Retrieve invoice for a completed charging session',
      successCondition: 'Request correctly routes to Session History / Invoice agent which retrieves the session record and provides or emails the invoice.',
    },
  },

  {
    category: 'routing-failure',
    severity: 'high',
    testMessage: 'Show me ChargeZone stations near Phoenix Mall Chennai.',
    failKeywords: ['no stations found', 'mumbai', 'delhi', 'bangalore', 'hyderabad'],
    passKeywords: ['chennai', 'phoenix', 'station', 'nearby', 'charger'],
    persona: {
      id: 'local-rf-003',
      name: 'Wrong Station List for Mentioned Location',
      description: 'User mentions Phoenix Mall Chennai. Agent shows stations for a different city or generic results ignoring the location hint.',
      behaviorRules: [
        'Must extract and prioritize any location mentioned in conversation context',
        'Must not override user\'s explicit location mention with GPS or default city',
        'If mentioned location is ambiguous, must ask for clarification',
        'Search results must confirm they are scoped to the user-mentioned location',
      ],
    },
    goal: {
      id: 'local-rf-003-g',
      objective: 'Find ChargeZone stations near a user-specified location',
      successCondition: 'Agent correctly identifies location from conversation, queries stations near that exact location, and presents results confirming the search scope.',
    },
  },

  {
    category: 'routing-failure',
    severity: 'high',
    testMessage: 'Can I pay with a credit card at ChargeZone?',
    failKeywords: ['top up your wallet', 'add money to wallet', 'please add funds'],
    passKeywords: ['credit card', 'card', 'payment', 'pay'],
    persona: {
      id: 'local-rf-004',
      name: 'Credit Card Payment Question Ignored',
      description: 'User asks whether they can pay with a credit card. Agent ignores the question and redirects to wallet top-up.',
      behaviorRules: [
        'Must directly answer whether credit card is accepted for payments',
        'Must not redirect to wallet top-up as the only option without confirming card payment status',
        'Should clarify the difference between direct card payment and wallet reload via card',
      ],
    },
    goal: {
      id: 'local-rf-004-g',
      objective: 'Understand if credit card payment is accepted at ChargeZone',
      successCondition: 'Agent directly answers credit card acceptance, clarifies the payment flow, and gives clear steps to pay using a card.',
    },
  },

  // ─── Conversation Flow Issues ──────────────────────────────────────────────

  {
    category: 'conversation-flow',
    severity: 'high',
    testMessage: 'I want to change my registered phone number to 9876543210.',
    failKeywords: ['what would you like to change', 'what do you want to update', 'what would you like to update'],
    passKeywords: ['phone', 'number', 'update', 'change', 'confirm'],
    persona: {
      id: 'local-cf-001',
      name: 'Phone Number Change Re-Ask Loop',
      description: 'After user confirms new phone number, agent asks again "what would you like to change?" — losing context and looping.',
      behaviorRules: [
        'Must maintain intent context across turns — if user stated "change phone number," this must persist',
        'Must not re-ask for what the user wants to change after they have already specified it',
        'Post-confirmation, agent should proceed to the update action, not restart intent capture',
      ],
    },
    goal: {
      id: 'local-cf-001-g',
      objective: 'Change registered phone number on ChargeZone account',
      successCondition: 'Agent captures the new phone number, confirms once, and completes the update without re-asking the original intent or looping.',
    },
  },

  {
    category: 'conversation-flow',
    severity: 'medium',
    testMessage: 'My wallet shows ₹0 balance but I just topped up ₹500.',
    failKeywords: ['your current balance is ₹0', 'balance is 0', 'wallet balance: ₹0'],
    passKeywords: ['transaction', 'check', 'recent', 'top up', 'investigate', 'ticket'],
    persona: {
      id: 'local-cf-002',
      name: 'Zero Wallet Balance Not Investigated',
      description: 'User complains wallet shows ₹0 despite topping up. Agent simply returns ₹0 balance without investigating.',
      behaviorRules: [
        'Must investigate recent top-up transactions when user reports unexpected ₹0 balance',
        'Must check for pending, failed, or processing transactions before confirming final balance',
        'Should offer to raise a support ticket if a top-up appears to be missing',
      ],
    },
    goal: {
      id: 'local-cf-002-g',
      objective: 'Resolve unexpected ₹0 ChargeZone wallet balance',
      successCondition: 'Agent checks recent transaction history, identifies any pending/failed top-up, and either explains the discrepancy or escalates to support.',
    },
  },

  {
    category: 'conversation-flow',
    severity: 'high',
    testMessage: 'Can I get a direct contact number or email to speak with someone at ChargeZone?',
    failKeywords: ['7 minute wait', 'waiting time is', 'queue', 'wait time'],
    passKeywords: ['contact', 'number', 'email', 'support', 'reach', 'call'],
    persona: {
      id: 'local-cf-003',
      name: 'Escalation Direct Contact Ignored',
      description: 'User explicitly asks for a direct contact. Agent ignores and keeps mentioning queue wait time.',
      behaviorRules: [
        'Must recognize explicit escalation requests ("speak to someone", "human agent", "call you")',
        'Must immediately provide the escalation path — phone number, email, or live chat',
        'Must not repeat queue wait time after user has explicitly asked for direct contact',
      ],
    },
    goal: {
      id: 'local-cf-003-g',
      objective: 'Reach a human ChargeZone support agent or get direct contact',
      successCondition: 'Agent recognizes escalation request, provides support contact number/email immediately, without looping back to bot flows.',
    },
  },

  {
    category: 'conversation-flow',
    severity: 'medium',
    testMessage: 'I want to register my Tata Nexon EV on my ChargeZone account.',
    failKeywords: ['would you like to register a vehicle', 'do you want to add a vehicle', 'register another vehicle'],
    passKeywords: ['nexon', 'registered', 'added', 'vehicle', 'success'],
    persona: {
      id: 'local-cf-004',
      name: 'Vehicle Registration Confirmation Loop',
      description: 'After vehicle registration completes, agent asks if they want to register a vehicle again.',
      behaviorRules: [
        'Must mark registration intent as complete after user confirms details',
        'Must not re-initiate a completed flow without a new user request',
        'Post-confirmation messages should be summary/next-steps, not a re-prompt for the same action',
      ],
    },
    goal: {
      id: 'local-cf-004-g',
      objective: 'Register an EV vehicle on ChargeZone account without loop',
      successCondition: 'Agent completes vehicle registration, confirms success, and transitions to helpful next steps without re-prompting to register again.',
    },
  },

  // ─── Wrong / Incomplete Behavior ──────────────────────────────────────────

  {
    category: 'wrong-behavior',
    severity: 'critical',
    testMessage: 'Find ChargeZone charging stations in Jaipur.',
    failKeywords: ['no stations found', 'no charging stations', 'not available in jaipur', 'no stations in jaipur'],
    passKeywords: ['jaipur', 'station', 'charger', 'location', 'nearby'],
    persona: {
      id: 'local-wb-001',
      name: 'Jaipur "No Stations" False Negative',
      description: 'User asks for stations in Jaipur. Agent incorrectly responds with "no stations found" despite stations existing in the area.',
      behaviorRules: [
        'Must perform a thorough geo-search including nearby areas when no exact-match stations found',
        'Must never return "no stations" without a radius-expanding fallback search',
        'If truly no stations exist, must clearly state so and suggest nearest city with coverage',
      ],
    },
    goal: {
      id: 'local-wb-001-g',
      objective: 'Find ChargeZone stations in or near Jaipur',
      successCondition: 'Agent performs geo-search, finds available stations in/near Jaipur, and presents them — or correctly states nearest coverage point if Jaipur truly has no stations.',
    },
  },

  {
    category: 'wrong-behavior',
    severity: 'high',
    testMessage: 'Are there ChargeZone stations on the Mumbai-Pune expressway?',
    failKeywords: ['yes.*no', 'no.*yes', 'stations are available.*no stations', 'no stations.*stations are available'],
    passKeywords: ['expressway', 'station', 'route', 'available', 'check'],
    persona: {
      id: 'local-wb-002',
      name: 'Expressway Contradictory Answer',
      description: 'User asks about expressway availability. Agent provides two contradictory statements in the same response.',
      behaviorRules: [
        'Must verify route-specific station data before responding',
        'A single response must never contain contradictory claims about the same location',
        'If data is uncertain, must say so clearly rather than hedging with contradictions',
      ],
    },
    goal: {
      id: 'local-wb-002-g',
      objective: 'Get accurate information about charging stations on a specific expressway',
      successCondition: 'Agent provides a single consistent answer about expressway station availability with no contradictions.',
    },
  },

  {
    category: 'wrong-behavior',
    severity: 'high',
    testMessage: 'I drive a Tata Punch EV. What connector type does it use?',
    failKeywords: [],  // duplicate detection handled programmatically
    passKeywords: ['punch', 'connector', 'type', 'ccs', 'ac', 'charger'],
    persona: {
      id: 'local-wb-003',
      name: 'Tata Punch EV Duplicate Response',
      description: 'User mentions Tata Punch EV. Agent sends the same response block twice in succession.',
      behaviorRules: [
        'Must never produce duplicate message blocks for the same query',
        'Vehicle-specific responses should be deduplicated before rendering',
        'If multiple agents contribute to a response, output must be merged, not concatenated',
      ],
    },
    goal: {
      id: 'local-wb-003-g',
      objective: 'Get vehicle-specific charging info for Tata Punch EV without duplicates',
      successCondition: 'Agent returns a single clean response with Tata Punch EV compatible station/connector information — with no duplicate message blocks.',
    },
  },

  {
    category: 'wrong-behavior',
    severity: 'medium',
    testMessage: 'The ChargeZone station at Koramangala shows the wrong location on the map.',
    failKeywords: ['what is the station id', 'what is the station name', 'which city are you in', 'what type of issue'],
    passKeywords: ['ticket', 'raised', 'noted', 'location', 'correction', 'report'],
    persona: {
      id: 'local-wb-004',
      name: 'Station GPS Wrong Location — Excessive Questioning',
      description: 'User reports wrong GPS location. Instead of raising a ticket immediately, agent asks 4+ clarifying questions before taking action.',
      behaviorRules: [
        'For clearly actionable issues (wrong GPS), must raise a support ticket after 1–2 essential questions at most',
        'Must not ask redundant clarifying questions when issue type is already clear',
        'Should capture: station name/ID + issue description, then escalate',
      ],
    },
    goal: {
      id: 'local-wb-004-g',
      objective: 'Report incorrect GPS location for a ChargeZone station',
      successCondition: 'Agent collects station identifier and issue in ≤2 turns, raises a location correction ticket, and provides user with ticket reference.',
    },
  },

  {
    category: 'wrong-behavior',
    severity: 'high',
    testMessage: 'My charging session got cut off midway and I was charged. Ticket number CZ-2024-5521.',
    failKeywords: ['raise a new ticket', 'create a new ticket', 'i will create a ticket', 'would you like me to raise'],
    passKeywords: ['cz-2024-5521', 'existing', 'ticket', 'status', 'update', 'escalate'],
    persona: {
      id: 'local-wb-005',
      name: 'Repeated Escalation After Ticket Created',
      description: 'User provides existing ticket number. Instead of looking it up, agent offers to raise a new escalation ticket.',
      behaviorRules: [
        'Must check existing open tickets when user provides a ticket number',
        'If a ticket reference is given, it must be looked up — not replaced with a new ticket',
        'Must not treat each turn as independent — session context about open tickets must persist',
        'Should proactively offer the ticket status and expected resolution timeline',
      ],
    },
    goal: {
      id: 'local-wb-005-g',
      objective: 'Follow up on existing support ticket without creating duplicates',
      successCondition: 'Agent retrieves the existing ticket by reference, provides its status/ETA, and does not create a duplicate ticket for the same issue.',
    },
  },

];

export default localEvidence;
