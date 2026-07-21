/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  // Stable cache path so CI can persist it — cold transforms are what made
  // the suite take ~10 min; warm it runs in ~2 s.
  cacheDirectory: '<rootDir>/.jest-cache',
  // Cold-transform runs can push the first heavy test past jest's 5 s default
  // (the one observed flake of the startSession test). 15 s is still a hang guard.
  testTimeout: 15000,
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?(/.*)?|@expo-google-fonts(/.*)?|expo-modules-core|@unimodules(/.*)?|react-navigation|@react-navigation(/.*)?|@supabase(/.*)?)/)',
  ],
  collectCoverageFrom: [
    'src/engine/**/*.ts',
    'src/services/googleDirections.ts',
    'src/services/audioState.ts',
    'src/services/aiInstructor.ts',
    'src/services/claudeFeedback.ts',
    'src/services/sessionPersistence.ts',
    'src/hooks/useDrivingSession.ts',
    'src/hooks/useVoiceConversation.ts',
  ],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  // Claude Code task worktrees live under .claude/worktrees — never sweep them
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/ios/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
