# LORD AI “Hey Lord” wake-word status

## Current implementation

There is no native wake-word plugin, Android microphone foreground service, or acoustic model in this repository. The former `WebSpeechWakeEngine` matched “Hey Lord” in general-purpose browser/Android WebView speech-recognition transcripts; it did not acoustically detect the phrase locally. That continuous-recognition path has been disconnected from the app's wake activation. The settings screen now reports that the model is unavailable, and does not request microphone access for wake listening.

Tap to Talk remains a separate, user-initiated command-recognition path through the existing LORD voice pipeline. Its browser/Android speech provider may have its own network and privacy behavior; it is not being used for wake detection. The in-app floating assistant remains dormant until a detector can activate it. It is not an Android overlay.

## openWakeWord Android port and model licensing

The evaluated `msnilsen/openwakeword-android` port runs openWakeWord inference locally using Android `AudioRecord` and ONNX Runtime. Its public README says it requires Android API 26+, while this project currently has `minSdkVersion = 24`. The port's code is Apache-2.0, the Google speech embedding model is Apache-2.0, and it documents built-in “Hey Jarvis”, “Alexa”, and “Hey Mycroft” models. Those pre-trained wake classifiers are CC BY-NC-SA 4.0 and are not appropriate to bundle in a commercial LORD AI build. Changing a model name does not change what it detects or its license.

openWakeWord's upstream code is Apache-2.0 and describes training custom classifiers from synthetic positive samples and negative audio. The repository does not include a “Hey Lord” model. A custom model could potentially be trained with no cash expenditure, but legal redistribution depends on the licenses and provenance of the speech-generation models, training data, shared inference assets, and resulting classifier. No license-cleared “Hey Lord” dataset, trained ONNX classifier, or model provenance record is present here, so this build cannot safely bundle or claim a working local detector. The exact missing deliverable is `hey_lord.onnx`, trained and validated from data with redistribution rights suitable for the LORD AI app, together with its license/provenance record and positive/negative test audio.

The Kotlin port is a small third-party integration (the public repository currently shows version 0.1.0 and three commits). It needs a compatibility review and API 26+ decision before adoption. Its README documents the custom model API and ONNX tensor shapes; real-device performance, accuracy, and dependency maintenance have not been verified in LORD AI.

## Background feasibility

The app already requests `RECORD_AUDIO`; it does not declare `FOREGROUND_SERVICE` or `FOREGROUND_SERVICE_MICROPHONE` and has no native audio service. On Android 14+ a microphone foreground service must declare the microphone service type and permission, and satisfy the runtime microphone permission prerequisites. Android restricts starting such services from the background, so a user-consented start would need to happen while LORD AI is visible. Android also restricts apps from launching activities from the background; a notification with a user-tapped pending intent is the reliable fallback. Force-stop, reboot, service stop, and locked-screen behavior are not implemented or verified.

No foreground service, overlay permission, or new Android permission has been added without a valid detector to run in it. The floating panel remains inside the LORD AI app. Future background work should use an explicit user-started microphone service, persistent notification and stop control, then notification-to-app navigation when the OS does not allow an activity launch.

## Verification status

Text matcher unit tests are not positive/negative acoustic model tests. No audio samples have been tested against a “Hey Lord” model, because there is no such model in the project. There has been no physical-device wake-word, background, lock-screen, or force-stop verification.
