<p align="center"><img src="public/favicon.svg" width="80" alt="Wings On Hair butterfly hair-clip logo"></p>

**v2.7: persistent wing travel, a manual USB endpoint slider, and signed Bluetooth firmware updates from GitHub. Fresh installs keep the motor off until a tested range is saved. One USB installation is required to add these features to v2.6 devices.**

[Travel and OTA setup](docs/TRAVEL-AND-OTA.md) · [v2.7 release notes](docs/RELEASE-v2.7.0.md)
<h1 align="center">Wings On Hair</h1>
<p align="center">A little movement. Entirely yours.<br>Android app · ESP32-C3 firmware · A butterfly you can build</p>
<p align="center"><a href="https://github.com/ParthSancheti/WingsOnHair/releases/latest">Download APK & firmware</a> · <a href="docs/HARDWARE.md">Parts & wiring</a> · <a href="docs/CUSTOMIZE.md">Make your own version</a></p>

**Version 2.6 · Created by [Parth Sancheti](https://github.com/ParthSancheti)**

A simple companion for a moving butterfly hair clip. Your phone sends Bluetooth LE commands to an ESP32-C3; one positional SG90 servo moves two mechanically linked wings. This repository includes the complete app, native Android project, Arduino firmware, illustrated wiring guide, and build instructions. No account, backend, or paid API is needed.

## See it

<p align="center">
  <img src="docs/screenshots/simple-mobile.png" width="260" alt="Light theme with pink fluid background and four glass mood cards">
  <img src="docs/screenshots/simple-mobile-dark.png" width="260" alt="Dark theme with glowing pink aurora">
  <img src="docs/screenshots/simple-name.png" width="260" alt="Optional name step in animated onboarding">
</p>

<details><summary>Welcome, desktop, connection and long-press preview</summary>

![Welcome](docs/screenshots/simple-welcome.png)
![Desktop home](docs/screenshots/simple-desktop.png)
<img src="docs/screenshots/simple-pairing.png" width="300" alt="Butterfly connection radar">
<img src="docs/screenshots/simple-mode-preview.png" width="500" alt="Mode preview over a blurred home screen">

</details>

These are actual browser renders. The background moves in the app; screenshots are still images. Preview mode is explicitly labelled and works without an accessory.

## Pick your starting point

| You want to… | Start here |
| --- | --- |
| Try it immediately | [Download the debug APK](https://github.com/ParthSancheti/WingsOnHair/releases/latest), or run the web preview below |
| Build the physical clip | [Parts, wiring, assembly and calibration](docs/HARDWARE.md) |
| Flash an ESP32-C3 | [Firmware setup and binary protocol](firmware/README.md) |
| Change the name, colors or motion | [Customization guide](docs/CUSTOMIZE.md) |
| Build your own APK | [Android setup and device checks](docs/ANDROID.md) |
| See what was tested | [Verification report](docs/VERIFICATION.md) |

## Run locally

Install **Node.js 22.12+** (Node 24 was used here) and Git:

```sh
git clone https://github.com/ParthSancheti/WingsOnHair.git
cd WingsOnHair
npm ci
npm run dev
```

Open the address Vite prints, normally `http://localhost:5173`. **Just looking? Try preview** works without hardware. **Get started** follows the animated welcome, optional name entry and connection radar. Names and settings stay on your device.

Browser Bluetooth needs supported Chrome/Edge at `localhost` or HTTPS. A plain HTTP LAN address on a phone does not enable Web Bluetooth. The APK uses native Bluetooth.

## Use your wings

1. Power the accessory. Tap Bluetooth, then **Connect wings**, and select `WingsOnHair`. Allow the phone's Bluetooth permissions.
2. Choose **Calm**, **Pulse**, **Energy**, or **Night**. Selecting a mood starts movement when connected or in Preview.
3. Use **Start/Pause** above the butterfly. **Your pace** adjusts frequency from 0.2 to 3.0 Hz.
4. Tap the butterfly for one quick flutter that returns to the previous motion. Hold a mood to preview it locally; choose **Use…** to apply it.
5. Use the moon/sun for appearance. Tap the circular app icon for About, update checks, and Replay welcome.

With v2.6 firmware, a 3.3 V touch sensor on ESP32-C3 **GPIO 3** cycles the same four modes and Pause without the phone. When connected, the app follows the accessory's reported mode, running state and rough runtime estimate. It checks GitHub for a newer release when opened or resumed and shows a direct APK download link when one is attached to that release. No installation occurs automatically.

| App mood | Firmware mode | Motion |
| --- | --- | --- |
| Calm | 1 · Velvet Breeze | Slow, gentle flutters |
| Pulse | 2 · Golden Pulse | Two flutters and a pause |
| Energy | 3 · Euphoria Rush | A faster rhythm |
| Night | 4 · Midnight Serenade | Soft, unhurried movement |

## Design and animation

One screen, a floating pill title bar, circular logo, four rounded glass cards and colored vector wings. Pink fluid orbs use 100–140 px blur, 25-second clockwise and 22-second counter-clockwise motion, and a bounded 20-second hue shift. Light mode blends pastel ink over `#f0f4f8`; dark mode blends glowing colors over `#050508`.

First-run motion includes icon expansion, a butterfly flying from the corner, a welcome settle, staggered spring motion on the optional name step, a connection radar and a home bounce. Presses soften surrounding content; long presses open a blurred preview. Capacitor supplies haptics where supported. Reduced-motion preferences shorten decorative transitions and freeze the fluid background.

No navigation tabs, main-screen telemetry grid, microphone controls or Custom Studio panels. Advanced custom curves remain available through the firmware protocol.

## Build the accessory

Start with one ESP32-C3 board, a positional SG90 with horn, a regulated servo supply, common-ground wiring, a clip base, two light wings and a linkage. The [full bill of materials](docs/HARDWARE.md#parts-list) includes tools and optional portable-power parts.

![Bench wiring: USB-powered ESP32-C3, GPIO 4 to servo signal, separate servo power and shared ground](docs/images/wiring.svg)

![Touch sensor VCC to 3V3, GND to GND, OUT to GPIO 3](docs/images/touch-wiring.svg)

**Start on the bench with the linkage removed.** Never power the servo from a GPIO or the board's 3.3 V rail. Calibrate before attaching wings or wearing the clip. The diagram is functional, not a physical pin map: locate GPIO 4 and GND on your exact board.

The complete [Arduino sketch](firmware/WingsOnHair_Firmware/WingsOnHair_Firmware.ino) uses nonblocking 20 ms updates, Bezier motion, a gentle greeting flap two seconds after power-up, touch mode switching, six-byte command validation, telemetry and graceful park/detach. It targets **Arduino-ESP32 3.3.12** and **NimBLE-Arduino 2.5.2**. No Servo library is needed.

```sh
arduino-cli config add board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32@3.3.12
arduino-cli lib install "NimBLE-Arduino@2.5.2"
arduino-cli compile --fqbn esp32:esp32:esp32c3 firmware/WingsOnHair_Firmware
arduino-cli board list
# Replace COM5 with your board's port; Linux/macOS use a /dev/... path.
arduino-cli upload --fqbn esp32:esp32:esp32c3 --port COM5 firmware/WingsOnHair_Firmware
```

Prefer compiling for your board. Prebuilt firmware targets the documented ESP32-C3 configuration; read its included flashing README.

## Build an APK

Install **JDK 21**, **Android SDK Platform 36**, and **Build Tools 36.0.0** through Android Studio. The native project is already included; do not run `cap add android` again.

On Windows, set `JAVA_HOME` / `ANDROID_HOME` if necessary, then:

```powershell
npm run android:build
```

On macOS/Linux, or for a manual build:

```sh
npm run android:sync
cd android
chmod +x gradlew
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Install on Android 7.0+ and allow installation from your download source. This is a **debug build for testing**. Store distribution needs your own release signing key and device acceptance checks. Signing keys are not included. See [ANDROID.md](docs/ANDROID.md).

## Verify a change

```sh
npm test
npm run test:ui
npm run build
```

Local UI tests use installed Chrome. To use bundled Chromium:

```powershell
npx playwright install chromium
$env:PLAYWRIGHT_BROWSER_CHANNEL = 'chromium'
npm run test:ui
```

On macOS/Linux use `PLAYWRIGHT_BROWSER_CHANNEL=chromium npm run test:ui`. GitHub Actions checks web/browser behavior, builds the Android APK and compiles firmware. [Verification scope](docs/VERIFICATION.md) distinguishes software tests from physical testing.

## Project map

```text
app.js                          Welcome, name, home, sheets, lifecycle
style.css                       Fluid background, glass, layout, motion
src/ui.js                       SVG butterfly, logo and icons
src/interactions.js             Press / hold / keyboard feedback
src/services/ble.js             Native BLE, Web Bluetooth, Preview
src/services/protocol.js        Packets, presets, shared motion curves
src/services/live-state.js      Reconcile accessory mode with app controls
src/services/updates.js         Public GitHub release lookup
android/                        Android source and Gradle wrapper
firmware/WingsOnHair_Firmware/   Complete ESP32-C3 sketch
firmware/README.md              Flashing, calibration, binary protocol
docs/HARDWARE.md                Parts, wiring, mechanical assembly
docs/CUSTOMIZE.md               Fork, rename, recolor, tune, release
docs/ANDROID.md                 Android setup and device checks
tests/                         Service, interaction and browser tests
.github/workflows/build.yml     CI builds
```

## Measurement limits

The butterfly follows the servo angle **commanded** by the ESP32, subject to radio latency. An SG90 has no measured position output. One motor drives linked wings; two SVG wings do not mean two independent motors.

Battery charge and health cannot be inferred from a regulated ESP32 supply. The v2.6 firmware reports a **rough runtime estimate** for the reported 150 mAh cell, assuming a full charge at boot and unmeasured current draw. It resets on boot and is not measured state of charge or a safety cutoff. Flash firmware over USB; the app checks public GitHub releases and offers a direct APK link, but does not install software silently.

## Privacy and reuse

The optional name and preferences stay locally. No analytics, login or cloud database. The app does not activate its retained sensor helper or request microphone access. GitHub receives normal network metadata during update checks and link visits. Default BLE control is not authenticated ownership enrollment: nearby devices can connect while the accessory advertises.

Original code and illustrations use the [MIT License](LICENSE); keep attribution in your version. Dependencies retain their own licenses. Bundled Manrope uses the [SIL Open Font License](docs/licenses/Manrope-OFL.txt). When contributing, include appropriate tests and document hardware results separately from simulations.
