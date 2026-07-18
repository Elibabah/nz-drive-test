module.exports = {
  speak: jest.fn((text, opts) => { opts?.onDone?.(); }),
  stop: jest.fn(),
  getAvailableVoicesAsync: jest.fn().mockResolvedValue([]),
  VoiceQuality: { Enhanced: 'Enhanced', Default: 'Default' },
};
