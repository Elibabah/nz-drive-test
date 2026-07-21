# ADR-0003: Audio duplex strategy for hands-free sessions

- **Status:** Proposed — pending a 1–2 day spike (blocking MVP-2)
- **Context:** The core product constraint is zero screen interaction while driving. Today the mic opens only after examiner questions or via tap-to-speak, which violates that constraint. `voiceRecognition.ts` already implements a continuous-listening API that `useVoiceConversation` does not use. Unknowns on iOS: echo (mic hears the examiner's TTS), Apple speech-recognizer session limits (~1 min segments), audio-session interruptions (CarPlay/Bluetooth, phone calls), and the maintenance state of `@react-native-community/voice`.
- **Options:**
  1. **Full duplex** — continuous STT with echo suppression; driver can barge in over TTS.
  2. **Half-duplex (plan B)** — mic always open *except* while TTS is playing (formalizing what `audioState.ts` half-does today); no barge-in.
  3. **Wake-word** — third-party wake-word engine gates the STT; smallest STT surface, extra dependency.
- **Spike will measure:** STT stability over 20+ min, echo/self-transcription during TTS, recovery after recognizer resets, behaviour with Bluetooth audio.
- **Partial decision (2026-07-21) — library settled by field evidence:** `@react-native-community/voice` hard-crashed the app (unhandled `NSException` in `-[AVAudioPCMBuffer setFrameLength:]`, captured in device crash logs) whenever the mic opened after expo-av TTS playback had reconfigured the audio session. Replaced with **expo-speech-recognition** (maintained, new-arch compatible, native continuous mode) behind the same `voiceRecognition.ts` interface. The duplex strategy (full duplex vs half-duplex vs wake-word) remains open pending the spike.
