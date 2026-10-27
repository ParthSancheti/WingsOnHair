# Verification — Wings On Hair 2.5

Verified on 27 October 2026. This report covers the pink fluid refresh, circular title-bar icon, expanded onboarding, simple four-card home and the accompanying builder documentation.

## Build and test results

| Check | Result |
| --- | --- |
| Service + press/hold tests | **23/23 passed**: 16 service and 7 interaction cases |
| Browser interaction/layout tests | **13/13 passed**, including motion-enabled tests; mobile light/dark screenshot case rerun after adding the dark capture |
| Web production bundle | **Passed**, Vite 8.3.5; main CSS 38.31 kB, main JavaScript 63.62 kB before compression |
| Android debug APK | **Passed**, JDK 21 / SDK 36 / Gradle 8.14.3; build completed in 1 minute 18 seconds |
| ESP32-C3 firmware | Earlier unchanged-source compile passed: 601,759 program bytes / 23,720 static RAM bytes |
| Firmware/source integrity | Current sketch SHA-256 matches the prebuilt package's manifest |

Firmware toolchain: Arduino CLI 1.5.1, Arduino-ESP32 3.3.12, NimBLE-Arduino 2.5.2. Source SHA-256: `e9854bcc9e15e932ee5d1c02039932a01234c888d67831c24f11d07eaa43c164`. The UI work does not alter the BLE format or sketch. The optional runtime-estimate build branch previously passed compiler syntax/API validation.

## What browser tests cover

- Welcome, optional name entry, persisted personalization, connection radar and explicit Preview.
- Four modes, running/paused intent, speed changes, storage reload and transient control behavior at the service layer.
- Pointer/keyboard holds, release suppression, local preview without mode selection, explicit application, cancellation and surrounding blur.
- Light/dark persistence, rounded title-bar icon, top spacing, Start/Pause above the butterfly and caption below it.
- Four fluid orbs, multiply/screen blend modes, exact base colors, 25/22-second motion and 20-second hue cycle. Transform matrices change with motion enabled.
- Launch icon expansion, welcome/idle-wing/mode-preview motion, and the Capacitor vibration call path. A browser vibration spy confirms software wiring, not physical vibration feel.
- About, replay, sheet dismissal, safe plain-text update results, retry after failure, and Bluetooth-unavailable recovery.
- Desktop 1440 × 1080, phone 390 × 844, narrow phone 320 × 568, and landscape 844 × 390. Controls remain reachable without horizontal overflow; small screens may scroll vertically.

Rendered screenshots are in `docs/screenshots/`. The new name flow, light/dark home and both documentation diagrams were visually inspected. SVG diagrams are accompanied by PNG renders in `docs/images/`; they are original illustrations, not photographs or board pin maps.

## Android scope

The APK includes the latest web bundle and matching launcher mark. Identity: `com.parthsancheti.wingsonhair`, version `2.5.0`, version code `250`, minimum API 24, target API 36. Native haptics, Bluetooth, lifecycle and system-bar code are included. The manifest has no unused microphone/audio permissions.

No physical phone, configured emulator or ESP32 accessory has been used for end-to-end acceptance. Real Bluetooth permission/enable dialogs, radio reliability, native Back and system bars, haptic feel, motor power and servo travel need the [device checks](ANDROID.md) and [bench calibration](HARDWARE.md).

## Measurement and release limits

- The avatar follows reported PWM commands; an SG90 supplies no measured-position output.
- Battery charge/health are unavailable by default. Optional runtime values are calibrated estimates, not voltage readings or health measurements.
- One servo drives two linked wings. No tested mechanical CAD, PCB or independently controlled two-servo mechanism is included.
- Shake, microphone beat-sync and advanced studio controls are not part of this simplified UI.
- GitHub update checks open release information. Firmware is flashed over USB; there is no silent APK installer or BLE firmware OTA path.
- The downloadable APK is debug-signed for testing. Store publication requires the maintainer's release key and device acceptance testing.

The release includes checksums for the APK and archives. Source packages omit dependencies, caches, SDK paths and signing secrets. CI repeats web, browser, Android and firmware builds on GitHub; this report records local evidence, not an assumption that a remote run has already passed.
