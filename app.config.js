const IS_DEV = process.env.APP_VARIANT === 'development';

export default {
  expo: {
    name: 'NZ Drive Practice',
    slug: 'nz-drive-practice',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'nzdrive',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0a0f1e',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.elibabah.drive.nzpractice2026',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'We need your location to provide real-time driving instructions and track your session route.',
        NSLocationAlwaysUsageDescription:
          'We need your location to provide real-time driving instructions during your session.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'We need your location to provide real-time driving instructions during your session.',
        NSMicrophoneUsageDescription:
          'We need the microphone to listen for your hazard detection responses.',
        NSSpeechRecognitionUsageDescription:
          'We use speech recognition to capture your hazard detection responses.',
      },
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0a0f1e',
      },
      package: 'com.nzdrivepractice.app',
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'RECORD_AUDIO'],
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    plugins: [
      'expo-router',
      'expo-location',
      'expo-web-browser',
      [
        'expo-av',
        {
          microphonePermission:
            'Allow NZ Drive Practice to access your microphone for hazard detection.',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
  },
};
