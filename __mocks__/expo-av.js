const mockSound = {
  setOnPlaybackStatusUpdate: jest.fn(),
  stopAsync: jest.fn().mockResolvedValue(undefined),
  unloadAsync: jest.fn().mockResolvedValue(undefined),
  playAsync: jest.fn().mockResolvedValue(undefined),
};

module.exports = {
  Audio: {
    Sound: {
      createAsync: jest.fn().mockResolvedValue({ sound: mockSound }),
    },
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  },
};
