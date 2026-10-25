# LORD AI voice and “Hey, LORD”

LORD's voice input uses the browser or Android WebView `SpeechRecognition` / `webkitSpeechRecognition` API through the shared voice pipeline. The same recognition service handles the “Hey, LORD” phrase and tap-to-talk transcription. There is no bundled acoustic wake model, no OpenWakeWord ONNX pipeline, and no native Android wake-word plugin in this project.

## What the wake phrase supports

The wake engine requests microphone access only after the user enables voice. It opens a continuous browser recognition session while the authenticated `/voice` page is active. The browser may end that session at any time; LORD restarts it with a bounded retry policy and stops after repeated interruptions. Users can retry or use tap-to-talk and typed chat. A wake phrase followed by command words in the same finalized transcript is submitted once; otherwise LORD opens a separate tap-to-talk recognition session. Recognition is stopped before spoken replies and is not restarted until playback has ended, preventing LORD's own speech from being treated as a command.

This is best-effort foreground phrase recognition. It is not an always-on wake-word engine and does not promise uninterrupted listening. Browser and Android WebView behavior varies by OS version, speech-service provider, network, and device. The app stops voice when its route is left or the app/tab is backgrounded.

## Android permissions and lifecycle

`android/app/src/main/AndroidManifest.xml` declares `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`. The user must grant microphone access through the operating system/WebView before recognition starts. The app does not hide microphone activity or bypass permission prompts. Android background microphone use is intentionally not implemented: there is no microphone foreground service, persistent notification, foreground-service microphone permission, or native wake detector. Locking the screen or backgrounding LORD ends voice mode and requires the user to return and enable it again.

Reliable background wake detection would require a separately designed native Android foreground service, visible notification, applicable foreground-service and microphone permissions, explicit user consent, and validation against current Android background-start rules and target device versions. None of those capabilities should be inferred from browser `SpeechRecognition` callbacks.

## Audio and privacy

The microphone is requested only after a user action. Raw recordings are not stored by LORD or sent to LORD's chat endpoint; the recognized transcript is sent through the existing authenticated `/api/chat` path and voice messages are saved under the signed-in user's conversation history. The browser or Android speech recognition provider may process audio according to its own behavior and privacy terms. If recognition is unavailable, denied, interrupted, or offline, LORD keeps typed chat available.

## Verification

Automated tests cover wake phrase matching, bounded restart behavior, and microphone permission handling. Physical Android devices are still needed to verify WebView permission prompts, speech-service availability, headset routing, audio focus, interruptions, and behavior across OS versions. No claim of background wake-word reliability is made.
