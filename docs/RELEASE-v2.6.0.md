# Wings On Hair 2.6 — Stay in sync

The companion now follows mode and pause changes made with the physical touch sensor. Reconnecting restores the ESP32's selected mode, pace and movement range instead of replacing them with stale phone settings. Rapid phone commands no longer flicker back to an older Bluetooth report.

- Touch sensor OUT connects to **GPIO 3**, VCC to **3V3**, GND to **GND**. One tap cycles Calm → Pulse → Energy → Night → Pause. Holding counts once.
- Servo signal stays on **GPIO 4**. Existing angles and preset ranges are unchanged. After power-on, wait two seconds for one gentle greeting flap.
- The connected app displays a clearly labelled runtime estimate for the reported **150 mAh** cell. It assumes a full charge at every boot and estimated current draw; it is not a measured charge level and resets on reboot.
- Automatic update checks run when the app opens or resumes, at most once per 30 minutes in a session. A newer public GitHub release produces an **in-app alert with an APK download link**. Publishing a commit alone does not trigger an app update. Installation remains manual; there is no background Android push notification.
- The app reads both the old 16-byte telemetry and the new 19-byte report. The new firmware requires the new app: **install the APK first, then flash the ESP32**.
- Touch-controlled motion continues without a phone. Disconnecting while the phone controls movement parks the wings. Backgrounding the app sends Pause.

## Install

1. Download `WingsOnHair-v2.6-debug.apk` below and install it. This is a debug-signed personal prototype build, not a store release. If Android rejects an upgrade because the existing signing key differs, uninstalling erases local app preferences; save anything needed first.
2. Extract `WingsOnHair-v2.6-source.zip`. Open `firmware/WingsOnHair_Firmware/WingsOnHair_Firmware.ino` in Arduino IDE.
3. Use ESP32C3 Dev Module, Arduino-ESP32 **3.3.12** and NimBLE-Arduino **2.5.2**. Select the connected port and upload. Use the board's documented USB CDC setting for Serial Monitor.
4. Connect the app. Tap the touch sensor through all four modes and Pause, then check that the mode card, pace and Start/Pause button follow. Reconnect while paused and check again.

See [hardware and wiring](HARDWARE.md), [Android build instructions](ANDROID.md), and [firmware protocol and upload steps](../firmware/README.md). The source archive includes the complete app, firmware, images and build instructions. Mechanical operation, power stability and battery accuracy still need checks on the actual assembly.
