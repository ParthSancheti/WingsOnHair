# Wings On Hair 2.5 — Pink Fluid

A simpler Android companion for a butterfly hair clip, with the complete ESP32-C3 firmware and illustrated builder documentation.

## In this release

- Pink fluid backgrounds: pastel multiply blending in light mode and glowing screen blending in dark mode, slow opposing rotations and a subtle hue shift.
- Floating rounded title bar with a circular butterfly/clip logo, more top spacing, and Start/Pause above the colored butterfly.
- Four rounded glass mood cards, a compact speed sheet, and local long-press previews with background blur.
- Animated icon launch, corner flight, welcome settle, optional name entry with spring motion, connection radar and home bounce. Haptic wiring and reduced-motion support.
- Complete six-byte BLE command / sixteen-byte telemetry implementation, native Android and browser Bluetooth, and explicit hardware-free Preview.
- ESP32-C3 sketch with nonblocking servo motion, input validation, one-flutter restoration, telemetry and graceful park/detach on stop/disconnect.
- Screenshots, parts list, color-coded bench wiring, mechanism concept, calibration steps and a guide to making your own version.

## Downloads

| File | Use |
| --- | --- |
| `WingsOnHair-v2.5-debug.apk` | Installable Android 7.0+ **debug** app for testing |
| `WingsOnHair-v2.5-esp32c3.zip` | Prebuilt ESP32-C3 firmware, manifest, flashing instructions and binary checksums |
| `WingsOnHair-v2.5-source.zip` | App, Android project, Arduino sketch, tests and documentation, without local dependencies/caches |
| `SHA256SUMS.txt` | Checksums for the three download archives/packages |

Install the APK, then choose **Try preview** without an accessory or **Get started** to name and connect your wings. For the physical build, start with [parts and wiring](https://github.com/ParthSancheti/WingsOnHair/blob/main/docs/HARDWARE.md). Flash via USB using the firmware archive's README or compile the included sketch for your board.

## Verified scope

23 service/interaction tests and 13 browser tests passed. The production web build and Android debug APK build passed. Firmware compilation uses Arduino-ESP32 3.3.12 / NimBLE-Arduino 2.5.2 and consumes 601,759 bytes of program storage and 23,720 bytes of static RAM; its source checksum matches the packaged build manifest.

No physical phone/accessory acceptance test is claimed. Check Bluetooth permissions, native haptic feel, power, servo calibration and mechanism clearance on your hardware. Battery charge/health and actual servo position are not fabricated: battery is unavailable by default, and the avatar follows commanded angle. There is no firmware OTA installer or tested mechanical CAD package.

Original code and illustrations: MIT License, © 2026 Parth Sancheti. Dependency licenses remain applicable. [Builder README](https://github.com/ParthSancheti/WingsOnHair#readme) · [Customization](https://github.com/ParthSancheti/WingsOnHair/blob/main/docs/CUSTOMIZE.md) · [Verification](https://github.com/ParthSancheti/WingsOnHair/blob/main/docs/VERIFICATION.md)
