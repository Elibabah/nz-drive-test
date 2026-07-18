/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?(/.*)?|@expo-google-fonts(/.*)?|expo-modules-core|@unimodules(/.*)?|react-navigation|@react-navigation(/.*)?|@supabase(/.*)?)/)',
  ],
  collectCoverageFrom: [
    'src/services/googleDirections.ts',
    'src/services/instructor.ts',
    'src/services/audioState.ts',
    'src/services/eventMonitor.ts',
    'src/services/sessionRecorder.ts',
    'src/services/aiInstructor.ts',
    'src/services/claudeFeedback.ts',
    'src/hooks/useDrivingSession.ts',
    'src/hooks/useVoiceConversation.ts',
  ],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
