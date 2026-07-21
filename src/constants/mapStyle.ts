// Google Maps SDK (iOS/Android) ignores `userInterfaceStyle` entirely — that
// prop only affects native chrome (Apple compass/attribution), never Google's
// tile rendering. A dark map with PROVIDER_GOOGLE requires a custom style
// JSON. Without this, the map renders in the default light "roadmap" style
// regardless of the app's dark theme, leaving white HUD text unreadable.
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1f2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a93a6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0f1e' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3a4155' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1f2e' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b8' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a5468' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#3a4258' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1626' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a5468' }] },
];
