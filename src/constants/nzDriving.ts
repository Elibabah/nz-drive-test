export const NZ_DRIVING = {
  SIDE_OF_ROAD: 'left',
  SESSION_DURATION_MINUTES: 20,
  SESSION_DURATION_MS: 20 * 60 * 1000,

  SPEED_ZONES: {
    DEFAULT_URBAN: 50,
    SCHOOL_ZONE: 40,
    OPEN_ROAD: 100,
  },

  HAZARD_PROMPT_INTERVAL_MS: 2.5 * 60 * 1000,
  HAZARD_PROMPT_VARIANCE_MS: 30 * 1000,

  KNOWLEDGE_PROMPT_INTERVAL_MS: 5 * 60 * 1000,
  KNOWLEDGE_PROMPT_VARIANCE_MS: 30 * 1000,

  MIN_PROMPT_GAP_MS: 45 * 1000,       // minimum gap between any two prompts
  DECISION_QUESTION_DELAY_MS: 4 * 1000, // delay after event before asking decision question
  MIN_DECISION_QUESTION_INTERVAL_MS: 60 * 1000,

  MANOEUVRE_COMMENT_DELAY_MS: 1500,
  MIN_MANOEUVRE_COMMENT_INTERVAL_MS: 30 * 1000,
  HARSH_BRAKING_THRESHOLD_KMH: 15,
  HARSH_BRAKING_MIN_SPEED_KMH: 20,
  HARSH_BRAKING_COOLDOWN_MS: 10 * 1000,
  UNEXPECTED_STOP_DURATION_MS: 4 * 1000,

  INSTRUCTOR_VOICE: {
    language: 'en-NZ',
    fallbackLanguage: 'en-AU',
    rate: 0.90,
    pitch: 1.0,
    volume: 1.0,
  },
} as const;

export const INSTRUCTION_TEMPLATES = {
  turnLeftImmediate: 'At the next intersection, turn left.',
  turnRightImmediate: 'At the next intersection, turn right. Give way to oncoming traffic.',
  turnLeft: (distance: string) => `In about ${distance}, turn left.`,
  turnRight: (distance: string) => `In about ${distance}, turn right. Give way to oncoming traffic.`,

  roundaboutExit: (exit: number) =>
    `At the roundabout, take the ${ordinal(exit)} exit. Give way to vehicles already on the roundabout.`,
  roundaboutStraight: 'At the roundabout, go straight ahead. Give way to vehicles already on the roundabout.',
  roundaboutLeft: 'At the roundabout, turn left. Give way to vehicles already on the roundabout.',
  roundaboutRight: 'At the roundabout, turn right. Give way to vehicles already on the roundabout.',

  keepLeft: 'Keep to the left-hand lane.',
  mergeLeft: 'Merge left. Check your mirrors and blind spot.',
  continueAhead: 'Continue straight ahead at the next intersection.',
  continueAheadIn: (distance: string) => `In about ${distance}, continue straight ahead.`,

  carryOn: 'Carry on, please.',
  keepFollowingRoad: 'Keep following this road.',
  followMainRoad: 'Follow the main road, please.',
  checkMirrors: 'Check your mirrors and maintain a two-second following distance.',

  sessionStartDriveOn: "We're starting your 20-minute driving practice. Keep left at all times. Drive on when you're ready.",
  sessionTwoMinutes: 'You have approximately two minutes remaining. Begin looking for a safe place to finish.',
  sessionEnd: 'That is the session finished. Pull over on the left when it is safe to do so.',
};

export const HAZARD_PROMPTS = [
  'Tell me what hazards you can see.',
  'What are you watching out for ahead?',
  'Describe any hazards you can see right now.',
  'What potential hazards are you aware of?',
  'What is your main concern at the moment?',
  'How are you adjusting your driving for current conditions?',
];

export const KNOWLEDGE_QUESTIONS: { question: string; expectedAnswer: string }[] = [
  { question: 'What is the speed limit in a school zone?', expectedAnswer: '40 km/h' },
  { question: 'At a roundabout, who has right of way?', expectedAnswer: 'vehicles already on the roundabout' },
  { question: 'How many seconds following distance should you keep in dry conditions?', expectedAnswer: '2 seconds' },
  { question: 'When must you give way to pedestrians at a zebra crossing?', expectedAnswer: 'always, to any pedestrian on or waiting at the crossing' },
  { question: 'What should you do before changing lanes?', expectedAnswer: 'check mirrors, signal for at least 3 seconds, do a head check' },
  { question: 'What is the default open road speed limit in New Zealand?', expectedAnswer: '100 km/h' },
  { question: 'When turning right at a green light, who must you give way to?', expectedAnswer: 'oncoming traffic and pedestrians crossing' },
  { question: 'What does a solid yellow centre line mean?', expectedAnswer: 'no overtaking is permitted' },
];

export const DECISION_QUESTIONS: Record<string, string[]> = {
  off_route: [
    "You went a different way to what I suggested. Can you tell me why?",
    "I noticed you took a different route there. What was your reasoning?",
  ],
  stop_complied: [
    "Good stop there. What were you checking for before you proceeded?",
    "Well done at that stop. Can you tell me what hazards you were looking for?",
  ],
  speed_change: [
    "You slowed down noticeably just then. What were you watching for?",
    "I noticed you reduced your speed. Can you tell me what you saw?",
  ],
};

export const MANOEUVRE_COMMENTS: Record<string, string[]> = {
  roundabout: [
    'Good. Well done at the roundabout.',
    'Good approach to the roundabout. Carry on.',
  ],
  stop_sign: [
    'Good stop. Carry on.',
    'Well done at the stop sign.',
  ],
  pedestrian_crossing: [
    'Well done at the pedestrian crossing.',
    'Good approach to the crossing.',
  ],
};

export const CARRY_ON_PHRASES = [
  'Carry on, please.',
  'Keep following this road.',
  'Follow the main road, please.',
  'Check your mirrors and maintain a two-second following distance.',
];

export const ENCOURAGEMENTS = [
  'Good observations. Keep it up.',
  'Well done. Stay focused ahead.',
  'Good. Maintain your current speed and position.',
  'That is correct. Keep scanning ahead.',
  'Good driving. Remember to keep checking your mirrors.',
];

function ordinal(n: number): string {
  const s = ['first', 'second', 'third', 'fourth', 'fifth'];
  return s[n - 1] ?? `${n}th`;
}
