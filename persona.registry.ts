import { type Persona, type SimulationGoal } from './types.js';

export const personas: Persona[] = [
  {
    id: 'p1_route_traveler',
    name: 'Highway Traveler (Route Planning)',
    description: 'A customer planning a long trip who wants to know where they can charge along their specific route.',
    behaviorRules: [
      'Be specific about your route.',
      'Ask for chargers on the way from Mumbai to Pune.',
      'Inquire about station amenities (washrooms, food) at those highway stops.'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g1_route_stops',
      objective: 'Find charging stations specifically on the Mumbai-Pune Expressway.',
      successCondition: 'Agent uses the Route agent to provide stations along the expressway.'
    }
  },
  {
    id: 'p2_payment_disputer',
    name: 'Billing Disputer (Payment Intent)',
    description: 'A user who is angry because they believe they were overcharged for a recent session.',
    behaviorRules: [
      'Use phrases like "my billing is incorrect" or "I was overcharged".',
      'Mention transaction ID TXN_101.',
      'Ask how you can raise a dispute for the ₹150 extra charge.'
    ],
    emotionalState: 'angry',
    language: 'English',
    primaryGoal: {
      id: 'g2_payment_dispute',
      objective: 'Report the incorrect charge and understand the dispute process.',
      successCondition: 'Agent routes to Payment agent and acknowledges the dispute for TXN_101.'
    }
  },
  {
    id: 'p3_2w_rider',
    name: '2W Rider (Policy Test)',
    description: 'An electric scooter owner (Ola S1) who wants to know if they can charge their 2-wheeler at a ChargeZone station.',
    behaviorRules: [
      'Ask clearly: "Can I charge my electric scooter at your stations?"',
      'If told no, ask why and if there are plans for 2W support.'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g3_2w_policy',
      objective: 'Verify if 2W/3W charging is supported.',
      successCondition: 'Agent correctly identifies that 2W/3W is NOT supported and provides a professional explanation.'
    }
  },
  {
    id: 'p4_coin_collector',
    name: 'Loyalty User (FAQ Intent)',
    description: 'A user curious about ChargeCoins and how to earn them.',
    behaviorRules: [
      'Ask about "ChargeCoins" and their value.',
      'Ask how many coins you earn for a 50kWh session.',
      'Inquire about redeeming coins for a Silver-to-Gold tier upgrade.'
    ],
    emotionalState: 'happy',
    language: 'English',
    primaryGoal: {
      id: 'g4_faq_loyalty',
      objective: 'Understand the ChargeCoin and Tier upgrade system.',
      successCondition: 'Agent routes to FAQ agent and explains coin earning and usage.'
    }
  },
  {
    id: 'p5_discovery_seeker',
    name: 'Area Explorer (Discovery Intent)',
    description: 'A user looking for chargers near a specific landmark in Gurgaon.',
    behaviorRules: [
      'Ask for chargers specifically "near Iffco Chowk, Gurgaon".',
      'Ask for the pricing and availability at the nearest station found.'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g5_discovery_landmark',
      objective: 'Find chargers near Iffco Chowk and check their current rates.',
      successCondition: 'Agent uses Discovery agent to list stations and provides pricing/availability.'
    }
  },
  {
    id: 'p6_qr_user',
    name: 'Station User (Session Intent)',
    description: 'A user who just arrived at a ChargeZone station in Jaipur and wants to start charging. They ask the agent to find a charger and then initiate the session.',
    behaviorRules: [
      'Start with: "I just arrived at a ChargeZone station in Jaipur. How do I start charging?"',
      'When agent finds stations, say: "I am at the first one you listed. Start the session."',
      'Ask about the connector types available.',
      'Follow the booking flow the agent provides.'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g6_session_start',
      objective: 'Find a real Jaipur station and initiate a charging session through the session agent.',
      successCondition: 'Agent routes to Session agent, identifies a real charger, shows available connectors, and begins the booking flow.'
    }
  },
  {
    id: 'p7_hinglish_user',
    name: 'Regional User (Hinglish)',
    description: 'A typical Indian user who mixes Hindi and English effortlessly.',
    behaviorRules: [
      'Use Hinglish phrases like "Mera refund kab tak aayega?", "Charger kidhar hai?", "Help karo please".',
      'Mix languages in a single sentence: "I want to start charging par scan nahi ho raha."',
      'Stay focused on the refund for transaction TXN_505.'
    ],
    emotionalState: 'neutral',
    language: 'Hinglish',
    primaryGoal: {
      id: 'g7_hinglish_refund',
      objective: 'Inquire about a refund for TXN_505 using Hinglish.',
      successCondition: 'Agent understands the Hinglish query and routes to Payment or Support appropriately.'
    }
  },
  {
    id: 'p8_impatient_platinum',
    name: 'Impatient Platinum Member',
    description: 'High-value customer who values time above all else. Hates repetition.',
    behaviorRules: [
      'If the agent asks for your phone number twice, get very annoyed.',
      'Refuse to answer the same question twice.',
      'Demand a human agent if the AI takes more than 3 turns to find a charger.'
    ],
    emotionalState: 'annoyed',
    language: 'English',
    primaryGoal: {
      id: 'g8_fast_discovery',
      objective: 'Find a charger in Wave City, Ghaziabad quickly without circular questioning.',
      successCondition: 'Agent finds the station within 2-3 turns without re-asking for basic info.'
    }
  },

  // ── New personas from real LangSmith session data ────────────────────────────

  {
    id: 'p9_zero_wallet',
    name: 'Low-Balance User (Wallet Top-Up Flow)',
    description: 'A user with ₹0 wallet balance who wants to charge their Nexon EV in Jaipur. First finds a charger via the agent, then hits the insufficient balance error.',
    behaviorRules: [
      'Start by asking: "I want to charge my EV in Jaipur. Which station is closest to me?"',
      'Pick the first station the agent shows and say: "Let me book at that one"',
      'When asked for amount, say ₹200.',
      'If told balance is insufficient or ₹0, ask: "How do I add money to my wallet?"',
      'If the agent gives a payment link or instructions, confirm and say thanks.'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g9_wallet_topup',
      objective: 'Find a real Jaipur charger, attempt ₹200 booking with ₹0 wallet, and get a top-up link.',
      successCondition: 'Agent detects ₹0 balance, clearly communicates this, and provides a Razorpay wallet top-up link or step-by-step top-up instructions.'
    }
  },

  {
    id: 'p10_jodhpur_traveler',
    name: 'Jodhpur Traveler (Small City Discovery)',
    description: 'A user visiting Jodhpur for a wedding who needs to charge their EV overnight. Jodhpur has only 5 stations — agent must be accurate about coverage.',
    behaviorRules: [
      'Start by asking: "Are there any ChargeZone stations in Jodhpur?"',
      'If agent confirms stations exist, ask: "Which one is closest to Madhuban Hotel?"',
      'Ask about overnight / time-based charging options (minimum 15 min per booking).',
      'Ask what the pricing is per kWh at those stations.',
      'If the agent gives more than 5 stations for Jodhpur, politely push back: "I thought Jodhpur only has a few stations."'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g10_jodhpur_discovery',
      objective: 'Find a ChargeZone station near Madhuban Hotel in Jodhpur and get pricing + availability information.',
      successCondition: 'Agent correctly identifies Jodhpur stations (max 5), shows the one near Madhuban Hotel, and provides accurate pricing (₹18–₹22/kWh or ₹14 if IOC-partnered).'
    }
  },

  // ── New personas from BRD coverage expansion ─────────────────────────────────

  {
    id: 'p11_connector_seeker',
    name: 'Connector Type Specialist (D-06 Filtering)',
    description: 'A Tesla owner visiting India who is confused about different connector types (CCS2 vs Type2). Tests the connector filtering capability.',
    behaviorRules: [
      'Ask: "What connectors do your chargers have? I have a Tesla so I need CCS2."',
      'If shown mixed connectors, ask: "Can you filter and show me ONLY the CCS2 ones?"',
      'Ask about pricing and availability for CCS2 chargers near Delhi.'
    ],
    emotionalState: 'neutral',
    language: 'English',
    primaryGoal: {
      id: 'g11_connector_filter',
      objective: 'Find CCS2-only chargers near Delhi to ensure Tesla compatibility.',
      successCondition: 'Agent filters chargers by CCS2 connector type and shows only compatible options with pricing and availability.'
    }
  },

  {
    id: 'p12_complaint_filer',
    name: 'Angry Complaint Filer (A-16 Support)',
    description: 'An angry customer whose charging session was interrupted 3 times at the same station. Wants to file a formal complaint and get compensation.',
    behaviorRules: [
      'Say: "I have had 3 failed sessions at the Jaipur Central station. This is unacceptable!"',
      'Ask: "How do I file a formal complaint? And will I get a refund for the failed attempts?"',
      'Demand escalation to management if not properly handled.',
      'Expect a complaint reference number or escalation confirmation.'
    ],
    emotionalState: 'angry',
    language: 'English',
    primaryGoal: {
      id: 'g12_complaint_formal',
      objective: 'File a formal complaint about repeated session failures and seek compensation.',
      successCondition: 'Agent routes to Support Agent, collects complaint details, provides complaint reference number, and escalates to station management.'
    }
  },

  {
    id: 'p13_hindi_only_user',
    name: 'Hindi-Only Speaker',
    description: 'A Hindi-only speaker who cannot read English at all. All messages in Hindi only. Tests multilingual capability.',
    behaviorRules: [
      'Use ONLY Hindi in every message — no English words except brand names.',
      'Start with: "नमस्ते, मुझे जयपुर में चार्जर चाहिए"',
      'Ask questions in Hindi: "कीमत क्या है?", "कौन सा कनेक्टर है?", "बुकिंग कैसे करूँ?"',
      'Complete a booking entirely in Hindi without mixing English.'
    ],
    emotionalState: 'neutral',
    language: 'Hindi',
    primaryGoal: {
      id: 'g13_hindi_only_booking',
      objective: 'Complete a full charger discovery and booking entirely in Hindi.',
      successCondition: 'Agent understands all Hindi queries, responds in clear Hindi (or translates), and completes the booking flow without forcing the user to use English.'
    }
  }
];

export const sampleGoals: SimulationGoal[] = [];
