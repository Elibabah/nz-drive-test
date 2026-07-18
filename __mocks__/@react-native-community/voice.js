const Voice = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),
  isAvailable: jest.fn().mockResolvedValue(true),
  onSpeechResults: null,
  onSpeechPartialResults: null,
  onSpeechError: null,
  onSpeechEnd: null,
};

module.exports = Voice;
