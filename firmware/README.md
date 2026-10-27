# Wings On Hair firmware · 2.5

ESP32-C3 BLE firmware for the companion app by **Parth Sancheti**. One SG90 drives mechanically linked left and right wings. The sketch uses Arduino-ESP32's LEDC peripheral directly; a separate Servo library is not required.

New builders: start with the [illustrated parts, wiring and assembly guide](../docs/HARDWARE.md). This page is the detailed firmware and protocol reference.

## Build and upload

Use **Arduino-ESP32 3.3.12**, **NimBLE-Arduino 2.5.2**, and **Arduino CLI 1.5.1** (or Arduino IDE 2.x with these board/library versions). The sketch uses the Arduino-ESP32 3.x `ledcAttach` / `ledcDetach` APIs and the NimBLE 2.x callback signatures.

From the repository root, with `arduino-cli` on your path:

```powershell
arduino-cli config add board_manager.additional_urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32@3.3.12
arduino-cli lib install "NimBLE-Arduino@2.5.2"
arduino-cli compile --fqbn esp32:esp32:esp32c3 .\firmware\WingsOnHair_Firmware
arduino-cli board list
# Replace COM5 with the port from board list. Match the board options to your board.
arduino-cli upload --fqbn esp32:esp32:esp32c3 --port COM5 .\firmware\WingsOnHair_Firmware
arduino-cli monitor --port COM5 --config baudrate=115200
```

In Arduino IDE, install “esp32 by Espressif Systems” in Boards Manager and “NimBLE-Arduino” in Library Manager, then open `WingsOnHair_Firmware/WingsOnHair_Firmware.ino`. Choose **ESP32C3 Dev Module** and your board's port. Some boards require holding BOOT while pressing RESET to enter the uploader. Native USB boards may need the **USB CDC On Boot** setting for serial logs; this does not change the BLE protocol.

The companion app's GitHub update checker opens release information. This firmware does **not** accept firmware images through its motion characteristic. Update it with the uploader above; an authenticated, rollback-capable firmware OTA transport is a separate feature.

## Wiring and calibration

| Connection | Destination |
| --- | --- |
| SG90 signal, usually orange/yellow | ESP32-C3 GPIO 4 (`SERVO_PIN`) |
| SG90 ground, usually brown/black | Common ground with ESP32 and servo supply |
| SG90 power, usually red | Suitable regulated servo supply, typically 5 V |
| ESP32-C3 power | Your development board's specified USB/VIN input |

Confirm GPIO 4 against your actual board schematic. Avoid flash, USB, and strapping pins. Do not power an SG90 from an ESP32 GPIO or its 3.3 V rail. Use a supply that can handle servo startup/stall current, a common ground, and appropriate local decoupling. A single-cell battery needs a suitable regulator/boost supply and protected charging hardware; a fully charged Li-ion cell must not be connected directly to a 3.3 V input.

Start with the linkage removed. Verify `SERVO_PULSE_MIN_US` (600) and `SERVO_PULSE_MAX_US` (2400), then calibrate for the particular servo. The application restricts requested motion to 15°–110°, but those angles are software conventions until the linkage is calibrated. Check the full sweep without binding before attaching wings or wearing the device. Quick-swap magnetic wings are a mechanical assembly feature, not something the firmware can detect.

The default boot state has **no servo PWM**. A valid movement command attaches PWM. Stop or disconnect eases to the current minimum angle over 450 ms, holds 250 ms, then detaches PWM and drives the signal low. Detaching removes commanded holding torque; it does not switch off the servo's power rail. Select a mechanism that can rest safely without holding torque.

## Motion protocol

Advertised name: **WingsOnHair**. The 128-bit service UUID is advertised; the name is also available in the scan response. The app filters by service.

| Purpose | UUID | GATT properties |
| --- | --- | --- |
| Service | `7a1b0001-6e3d-4b7a-9c21-8f5d0a2e6c10` | — |
| Command | `7a1b0002-6e3d-4b7a-9c21-8f5d0a2e6c10` | WRITE with response |
| Telemetry | `7a1b0003-6e3d-4b7a-9c21-8f5d0a2e6c10` | READ, NOTIFY |

Write **exactly six unsigned bytes**, with no text, JSON, delimiter, or checksum:

| Byte | Value | Accepted range |
| --- | --- | --- |
| 0 | Mode | 0–6 |
| 1 | Minimum angle | 15–109; less than maximum |
| 2 | Maximum angle | 16–110; greater than minimum |
| 3 | Frequency × 10 | 2–30 = 0.2–3.0 Hz |
| 4 | First Bezier control x × 100 | 5–95 |
| 5 | First Bezier control y × 100 | 5–95 |

Modes: **0** stop, **1** Velvet Breeze, **2** Golden Pulse, **3** Euphoria Rush, **4** Midnight Serenade, **5** custom, **6** one transient flutter. The mood parameters are sent by the app; the firmware does not silently replace them. For example, `[5, 20, 90, 8, 35, 65]` selects a custom 20°–90° motion at 0.8 Hz.

Malformed lengths or out-of-range fields are ignored without changing motion. A successful GATT write confirms transport delivery; telemetry is the authoritative current mode/angle. Only one active central is accepted, and subsequent connections are rejected. Commands are staged under a critical section and consumed by the main loop; BLE callbacks never drive the servo.

This six-byte protocol is a local control interface, not an authenticated ownership system. The default firmware does not require a bond or a passkey: a nearby device can connect when it is advertising. Do not describe discovery/connection as cryptographically authenticated pairing. Adding ownership enrollment or passkey pairing requires corresponding app and firmware changes.

### Curve shared with the application

Let `E(t)` be cubic Bezier easing with endpoints `(0,0)`, `(1,1)` and controls `(x/100,y/100)`, `(0.75,1)`. Solve the curve's x coordinate for time with 14 bisection iterations before evaluating y. Let `p` be the fractional phase advancing at `speed/10` cycles per second:

```text
Modes 1, 3, 4, 5, 6:
  amount = p < 0.5 ? E(2*p) : 1 - E(2*p - 1)

Mode 2:
  if p >= 0.70: amount = 0
  else:
    q = fractionalPart(p / 0.35)
    amount = q < 0.5 ? E(2*q) : 1 - E(2*q - 1)

target = minimum + (maximum - minimum) * amount
```

Golden Pulse has two flaps in the first 70% of a cycle and a 30% pause. Mode 6 runs one regular cycle, then restores the previous mode and its parameters from phase zero. Repeated mode-6 commands restart the transient without replacing the saved previous mode. A new regular command, stop, or disconnect supersedes the transient. If the previous mode was stopped, the servo parks and detaches after the flutter.

The servo updates every 20 ms. Target changes are limited to 480°/s at the PWM output to avoid instantaneous large jumps; an SG90 can still lag under load. The avatar follows **commanded angle** notifications. There is no claim of measured mechanical position or zero-latency synchronization.

### Telemetry

Notifications are exactly **16 bytes**, sent at 10 Hz while connected. They fit the default BLE ATT MTU of 23, so the protocol does not rely on MTU negotiation. Battery estimate/unavailable fields are refreshed every five seconds and repeated in each motion notification.

| Byte | Meaning |
| --- | --- |
| 0 | Magic `0x57` |
| 1 | Protocol version `1` |
| 2 | Sequence number, wraps 255→0 |
| 3 | Current mode 0–6 |
| 4 | Rounded commanded PWM angle, degrees |
| 5 | Rounded curve target/parking target angle, degrees |
| 6 | Battery percent 0–100; `255` means unavailable |
| 7 | Battery kind: 0 unavailable, 1 runtime estimate, 2 measured (reserved) |
| 8–11 | Uptime in seconds, unsigned 32-bit little endian |
| 12 | Flags: bit 0 active motion, bit 1 PWM attached; other bits zero |
| 13 | Frequency × 10 |
| 14 | Impulse x percent |
| 15 | Impulse y percent |

The sequence number permits the app to estimate telemetry continuity. It is not a radio RSSI measurement or a packet acknowledgement. During parking, active-motion is false and PWM-attached remains true until detachment. Uptime accumulation handles `millis()` rollover.

## Battery: what the hardware can actually tell us

ESP32-C3 ADC channels read external analog inputs. Its ADC reference is not a built-in battery-voltage or state-of-charge measurement. A regulated 3.3 V supply also cannot reveal battery capacity or health. With no battery-sense hardware, the correct default is **unavailable** (`255`, kind `0`). The SG90 has no return wire for position or health telemetry either.

An optional runtime estimate is implemented behind `WOH_ENABLE_RUNTIME_BATTERY_ESTIMATE=1`. Calibrate `ESTIMATE_CAPACITY_MAH`, `ESTIMATE_INITIAL_PERCENT`, `ESTIMATE_IDLE_MA`, and `ESTIMATE_SERVO_EXTRA_MA` for the actual assembly first. It integrates estimated current over uptime and reports kind `1`, never measured kind `2`. It resets on reboot, assumes a known initial charge, and does not account for charging, battery swaps, temperature, aging, load variation, or actual remaining charge. It must remain labelled **Estimated** in the UI; battery **health** remains unavailable. A real fuel gauge or suitable voltage-sense circuit is required for measurement.

## Build verification

The final source was compiled and linked successfully on **26 October 2026** for `esp32:esp32:esp32c3` with Arduino CLI 1.5.1, Arduino-ESP32 3.3.12, and NimBLE-Arduino 2.5.2. The resulting application uses **601,759 bytes of program storage (45%)** and **23,720 bytes of static RAM (7%)**. The optional runtime-estimate branch also passed a separate ESP32-C3 C++ syntax/API check.

The binary bundle in `releases/WingsOnHair-v2.5-esp32c3.zip` includes a complete merged image, segmented images, exact flash offsets, build metadata, and SHA-256 checksums. It targets the generic ESP32-C3 development-board configuration with **4 MB flash, DIO, 80 MHz flash, and GPIO 4 servo signal**. Verify your board and mechanism before using those defaults. Full compile output is retained in `firmware/build/build-log.txt`; local dependency caches are excluded from source delivery.

## Bench acceptance checks

1. Boot without a phone: confirm no PWM and no commanded movement.
2. Connect, subscribe, and verify 16-byte frames and advancing sequence/uptime.
3. Write each preset and custom packet; compare telemetry to the requested bounds.
4. Try zero-, five-, seven-byte and out-of-range packets; motion must not change.
5. Trigger mode 6 while running and while stopped; verify restoration and detachment.
6. Stop, disable phone Bluetooth, and move out of range; verify graceful parking after the BLE stack detects disconnection and successful reconnection.
7. Exercise min/max angles and high speeds with the linkage removed before loading it.

The source can be compile-verified without a connected board. Mechanical travel, power stability, BLE range, actual battery behavior, and servo timing require the real assembly and are not established by a successful compile.

## Primary references

- [Espressif Arduino-ESP32 LEDC API](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ledc.html)
- [ESP32-C3 ADC documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32c3/api-reference/peripherals/adc.html)
- [ESP32-C3 hardware design checklist](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/schematic-checklist.html)
- [NimBLE-Arduino 2.5.2 server example and callback signatures](https://github.com/h2zero/NimBLE-Arduino/blob/2.5.2/examples/NimBLE_Server/NimBLE_Server.ino)
