# Build your butterfly clip

This is a **bench-first prototype**: an ESP32-C3, one positional micro servo and two linked wings. Code and electrical connections are provided. Fit the linkage and enclosure to your parts; there is no tested STL, PCB or production-ready wearable mechanism in this repository.

## Parts list

### Electrical bench build

| Qty | Part | Selection notes |
| --- | --- | --- |
| 1 | ESP32-C3 development board | USB programming, accessible GPIO 4 and GND, published pinout. Build target: ESP32C3 Dev Module, 4 MB flash |
| 1 | Positional SG90-class servo | Include horn and center screw. Do not use a continuous-rotation/360° servo |
| 1 | Regulated servo supply | Match your servo; typically 5 V. At least 2 A is a useful starting supply rating for one servo; verify startup/stall demand |
| 1 | USB **data** cable | Matches the board; supplies/programs the ESP32 during bench work |
| 3+ | Insulated wires and connectors | Signal, ground, motor power. Use adequately sized power wires; breadboards are for low-current prototyping |
| 1 | 470–1000 µF electrolytic capacitor, ≥10 V | Suggested starting decoupling near servo connector; verify polarity and tune as needed |
| 1 | 100 nF ceramic capacitor | Across the servo supply near its connector |
| 1 set | Power switch and appropriate current protection | Rated for supply/load; make power-off accessible |

Tower Pro specifies its SG90 at 4.8 V and notes substantial current demand. Voltage limits and travel vary across variants and clones; use your exact servo's specification. [Manufacturer information](https://towerpro.com.tw/product/sg90-7/).

### Clip and mechanism

| Qty | Part | Purpose |
| --- | --- | --- |
| 1 | Hair clip / barrette base | Secure mount and insulated electronics platform |
| 2 | Lightweight wings | Thin foam or PET; keep both sides balanced |
| 2 | Wing pivots / hinges | Low friction, no exposed sharp ends |
| 1 set | Servo horn, crank and two rods | Convert one servo's movement into mirrored flapping |
| 1 | Rigid mount / enclosure | Prevent twisting; keep hair away from joints |
| As needed | Screws, spacers, heat-shrink, strain relief | Secure and insulate assembly |
| Optional | Captive magnets and mating attachments | Quick-swap wings; mechanically retain magnets |

Tools: multimeter, screwdriver, wire stripper, soldering iron, ruler and preferably a current-limited supply. A 3D printer is optional for custom mounts.

### Portable power, optional

The first build should stay on a bench supply. A battery version additionally needs a protected cell/pack, a charger matched to that cell, a power-path circuit or charge/run disconnect, a regulator sized for servo current, connectors, a switch and an insulated enclosure. Battery capacity alone does not establish safe peak current.

A single-cell lithium charger is **not** a 5 V regulator. Use suitable regulation for both the servo rail and your board's specified input. Never connect a fully charged cell directly to 3V3. Do not charge while wearing the clip. Consult your exact board and charger schematics before combining USB, battery and charging paths; there is no universal charger-module wiring assumed here.

## Wiring

![Functional bench wiring](images/wiring.svg)

This diagram is functional, not a physical header map. **GPIO 4 is not the fourth pin.** C3 board layouts and power circuits differ.

| From | To | Notes |
| --- | --- | --- |
| ESP32 GPIO 4 | Servo signal, usually orange/yellow | Sketch constant `SERVO_PIN = 4` |
| ESP32 GND | Servo ground and supply negative | All grounds share a reference |
| Regulated servo supply positive | Servo power, usually red | Never GPIO or 3V3 |
| Servo supply negative | Common ground | Short, adequately sized return |
| USB data cable | ESP32 USB socket | Board power/programming in this bench arrangement |
| Bulk + ceramic capacitors | Across servo power and ground near connector | Electrolytic positive to supply positive |

**Do not connect the external servo positive rail to ESP32 5V/VIN while USB also powers the board unless its documented power circuit supports that.** Here, only ground and signal are shared. Espressif describes mutually exclusive supply options for its reference DevKitM-1; verify the schematic of your particular board. [Espressif board/power guide](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32c3/esp32-c3-devkitm-1/index.html).

Keep motor-current returns out of thin signal wires. Resets during movement usually warrant checking voltage sag, connectors and current capacity. Capacitors help transients but cannot replace a suitable supply. Confirm connector polarity before applying power.

The ESP32 supplies a 3.3 V control signal. Confirm the servo accepts it; otherwise use a suitable unidirectional level buffer. Never apply 5 V to an ESP32 GPIO.

## Flash

1. Leave the linkage/horn disconnected and motor power off. Connect ESP32 USB.
2. Follow the pinned [firmware installation/upload instructions](../firmware/README.md#build-and-upload). Select **ESP32C3 Dev Module**.
3. Confirm `SERVO_PIN` against your board. Change it before compiling if GPIO 4 is unavailable.
4. Upload and open the serial monitor at 115200 baud. If needed, check cable/driver and the board's BOOT/RESET sequence.
5. Power off, wire the servo, inspect polarity/ground, then apply power. Boot generates no servo PWM until a movement command arrives.

Prebuilt firmware targets the documented 4 MB ESP32-C3. Compile the sketch for your board instead of guessing flash offsets. The firmware archive has its own flashing README.

## First movement and calibration

1. Start with a free servo shaft. Keep hair, fingers and wires away from the horn.
2. Connect in the app and select **Calm**. Keep the power switch accessible. Check that Pause parks and then detaches PWM.
3. The starting mapping is 600–2400 µs for nominal software angles 0–180°. The allowed 15–110° range therefore maps to approximately 750–1700 µs. These are parameters, not guaranteed physical angles or limits for your servo.
4. If it buzzes, hits a stop or draws excessive current, cut power. Narrow `SERVO_PULSE_MIN_US` / `SERVO_PULSE_MAX_US` and reflash. A starting mapping such as 1000–2000 µs reduces travel but still needs validation.
5. Find a safe rest position. Switch off before attaching or repositioning the horn. Do not force a powered shaft.
6. Fit a light linkage, run slowly, and check the complete sweep for binding. Adjust linkage length/lever radius, or narrow preset travel in `src/services/protocol.js`.
7. Check all modes, intended maximum speed, flutter, Pause, app backgrounding and Bluetooth disconnection. Inspect heat, resets, clip stability and wiring through repeated cycles before wearing.

Stop/disconnect parks over 450 ms, holds 250 ms, then detaches PWM. Detachment removes commanded holding torque, **not servo power**. Design the mechanism to rest safely without torque. Packet loss alone is not an emergency stop; use the physical power switch for servicing.

## Mechanism

![Conceptual linkage; not a fabrication drawing](images/mechanism.svg)

Use a servo horn/crank with one rod to each wing lever. Orient the pivots so both wings rise in mirrored motion. Avoid straight-through, dead-center linkage positions. Start with short, light wings. Horn radius and hole spacing determine travel and torque; the illustration is not to scale.

The app has two SVG wings, but the firmware drives **one motor**. Independent hardware movement requires a second output, revised packets and app changes.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Device missing | Correct firmware/board, ESP32 power, no other connected phone, Bluetooth and permissions |
| Connected but still | Choose a mode; inspect servo power, common ground, signal pin and polarity |
| Jerks / board resets | Supply sag, thin wiring, loose ground, binding, decoupling |
| Wrong direction | Horn/linkage geometry; power off before repositioning |
| Buzzing at an endpoint | Mechanical stop or pulse mismatch; cut power and narrow travel |
| Avatar slightly ahead | Avatar reports commanded angle; physical motion also depends on load/radio latency |
| No battery percentage | Expected by default; regulated voltage cannot reveal charge. Runtime estimate requires calibration |
| Upload fails | Board/port selection, data cable, serial monitor closed, BOOT/RESET |

No physical accessory was available for verification. Include your board model, servo variant, wiring photo and measured behavior in hardware reports. [Verification scope](VERIFICATION.md).
