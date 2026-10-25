# LORD AI voice assistant

The authenticated `/voice` route provides tap-to-talk and an opt-in “Hey, LORD” phrase using the browser or Android WebView `SpeechRecognition` API. The wake engine and tap-to-talk recognizer share the existing `VoicePipeline`; transcripts use the existing authenticated `/api/chat` endpoint and saved conversation behavior. The dashboard quick action and primary navigation open this route.

Microphone permission is requested only after the user activates voice. Voice mode stops when the route is left or the page/app is backgrounded. Browser recognition can be interrupted and is not a guaranteed continuous or background wake-word engine. The implementation does not include a native Android microphone foreground service or acoustic wake model. On unsupported browsers, after permission denial, or during recognition/network errors, typed chat remains available.

Recognized text is sent to LORD; raw audio is not saved by LORD or sent to its chat API. The browser or Android speech service may process audio remotely under its own behavior and privacy terms. Spoken replies use browser speech synthesis, can be interrupted, and are independently controlled from subtitles.

For Android permissions and lifecycle limits, see [WAKE_WORD.md](./WAKE_WORD.md). Physical-device verification is required for WebView microphone prompts, headset routing, audio focus, and speech-service behavior on target Android versions.
