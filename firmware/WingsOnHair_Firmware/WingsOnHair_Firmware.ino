/**
 * Wings On Hair 2.7 — Parth Sancheti
 * ESP32-C3 · Arduino-ESP32 3.3.12 · NimBLE-Arduino 2.5.2
 *
 * One SG90 drives the linked left/right wings. The reported angle is the
 * commanded servo angle, not a position measurement: an SG90 has no feedback.
 * No ADC reading is fabricated. Battery is unavailable unless the explicitly
 * opt-in, calibrated runtime estimate below is enabled.
 */
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <math.h>
#include <string.h>
#include "DeviceServices.h"
#include "ManualControl.h"

// GPIO 4 is available on common C3 boards; confirm against YOUR board schematic.
// Do not use flash/USB/strapping pins. Change this pin before flashing if needed.
constexpr uint8_t SERVO_PIN = 4;
// Three-pin, active-high capacitive touch module (for example TTP223).
// Check GPIO 3 on your exact board; never feed a 5 V output into this pin.
constexpr uint8_t TOUCH_PIN = 3;
constexpr uint32_t TOUCH_DEBOUNCE_MS = 50;
constexpr uint32_t STARTUP_FLAP_DELAY_MS = 2000;
// Small, central sweep for the power-on greeting. Calibrate for your linkage.
constexpr uint8_t STARTUP_FLAP_MIN_ANGLE = 45;
constexpr uint8_t STARTUP_FLAP_MAX_ANGLE = 60;
constexpr uint32_t SERVO_FREQUENCY_HZ = 50;
constexpr uint8_t SERVO_RESOLUTION_BITS = 14;
// Conservative SG90 starting calibration. Tune with the mechanism detached.
constexpr uint16_t SERVO_PULSE_MIN_US = 600;   // nominal 0 degrees
constexpr uint16_t SERVO_PULSE_MAX_US = 2400;  // nominal 180 degrees
constexpr float MAX_SLEW_DEGREES_PER_SECOND = 90.0f;
constexpr uint32_t SERVO_TICK_MS = 20;
constexpr uint32_t PARK_DURATION_MS = 450;
constexpr uint32_t PARK_HOLD_MS = 250;
constexpr uint32_t TELEMETRY_PERIOD_MS = 100;
constexpr uint32_t BATTERY_PERIOD_MS = 5000;

// Rough runtime estimate, NOT measured state of charge or battery health.
// Assumes the 150 mAh cell is FULL at every boot. Tune current values after
// measuring your actual assembly; charging or a battery swap is not detected.
#ifndef WOH_ENABLE_RUNTIME_BATTERY_ESTIMATE
#define WOH_ENABLE_RUNTIME_BATTERY_ESTIMATE 1
#endif
constexpr float ESTIMATE_CAPACITY_MAH = 150.0f;
constexpr float ESTIMATE_INITIAL_PERCENT = 100.0f;
constexpr float ESTIMATE_IDLE_MA = 35.0f;
constexpr float ESTIMATE_SERVO_EXTRA_MA = 180.0f;

constexpr char SERVICE_UUID[] = "7a1b0001-6e3d-4b7a-9c21-8f5d0a2e6c10";
constexpr char COMMAND_UUID[] = "7a1b0002-6e3d-4b7a-9c21-8f5d0a2e6c10";
constexpr char TELEMETRY_UUID[] = "7a1b0003-6e3d-4b7a-9c21-8f5d0a2e6c10";
constexpr uint16_t NO_CONNECTION = 0xffff;

// Wire command: [mode, min, max, frequency * 10, x * 100, y * 100].
// 0 stop, 1 velvet, 2 golden, 3 euphoria, 4 midnight, 5 custom, 6 one flutter.
struct MotionCommand {
  uint8_t mode;
  uint8_t minimum;
  uint8_t maximum;
  uint8_t speed;
  uint8_t x;
  uint8_t y;
};

// Explicit prototypes keep Arduino's sketch preprocessor from placing
// declarations that use MotionCommand before the type definition above.
static bool decodeCommand(const uint8_t* bytes, size_t length, MotionCommand& result);
static float sampleMotion(double phase, const MotionCommand& command);
static void applyCommand(const MotionCommand& command, uint32_t now);

static NimBLECharacteristic* telemetryCharacteristic = nullptr;
static portMUX_TYPE mailboxMux = portMUX_INITIALIZER_UNLOCKED;
// BLE callbacks run in another task. Only these mailbox fields cross tasks.
static MotionCommand mailboxCommand = {0, 15, 85, 8, 35, 65};
static bool mailboxPending = false;
static bool mailboxDisconnected = false;
static uint16_t activeConnection = NO_CONNECTION;

// All following state is owned by Arduino's loop task.
static MotionCommand motion = {0, 15, 85, 8, 35, 65};
static MotionCommand beforeFlutter = motion;
static uint8_t selectedMode = 1;
static bool servoAttached = false;
static bool parking = false;
static float commandedAngle = 15.0f;
static float targetAngle = 15.0f;
static float parkStartAngle = 15.0f;
static float parkTargetAngle = 15.0f;
static double cyclePhase = 0.0;
static uint32_t parkStartedMs = 0;
static uint32_t parkReachedMs = 0;
static uint32_t lastServoMs = 0;
static uint32_t lastLoopMs = 0;
static uint32_t lastTelemetryMs = 0;
static uint32_t lastBatteryMs = 0;
static uint64_t uptimeMs = 0;
static double estimatedConsumedMah = 0.0;
static uint8_t batteryPercent = 255;
static uint8_t batteryKind = 0;
static uint8_t telemetrySequence = 0;
enum class ControlSource : uint8_t { None, Phone, Touch };
static ControlSource controlSource = ControlSource::None;
static bool touchRaw = false;
static bool touchStable = false;
static uint32_t touchChangedMs = 0;
static uint32_t bootStartedMs = 0;
static bool startupFlapPending = true;

// Keep these values in sync with src/services/protocol.js PRESETS.
static const MotionCommand TOUCH_PRESETS[4] = {
    {1, 25, 85, 6, 40, 20},   // Velvet Breeze
    {2, 20, 100, 8, 20, 80},  // Golden Pulse
    {3, 15, 110, 22, 15, 85}, // Euphoria Rush
    {4, 35, 90, 4, 65, 15},   // Midnight Serenade
};

static float clampFloat(float value, float minimum, float maximum) {
  return fminf(maximum, fmaxf(minimum, value));
}

static bool decodeCommand(const uint8_t* bytes, size_t length, MotionCommand& result) {
  if (length != 6) return false;
  if (bytes[0] > 6 || bytes[1] < 15 || bytes[2] > 110 || bytes[1] >= bytes[2] ||
      bytes[3] < 2 || bytes[3] > 30 || bytes[4] < 5 || bytes[4] > 95 ||
      bytes[5] < 5 || bytes[5] > 95) return false;
  result = {bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]};
  return true;
}

static float cubicCoordinate(float t, float first, float second) {
  const float inverse = 1.0f - t;
  return 3.0f * inverse * inverse * t * first +
         3.0f * inverse * t * t * second + t * t * t;
}

// Solve the x coordinate before evaluating y: the input is time, not Bezier t.
// Both clients use control points (x, y) and (0.75, 1), with endpoints (0,0),(1,1).
static float impulseEase(float time, uint8_t xPercent, uint8_t yPercent) {
  if (time <= 0.0f) return 0.0f;
  if (time >= 1.0f) return 1.0f;
  float low = 0.0f;
  float high = 1.0f;
  const float x = xPercent / 100.0f;
  for (uint8_t i = 0; i < 14; ++i) {
    const float midpoint = (low + high) * 0.5f;
    if (cubicCoordinate(midpoint, x, 0.75f) < time) low = midpoint;
    else high = midpoint;
  }
  return cubicCoordinate((low + high) * 0.5f, yPercent / 100.0f, 1.0f);
}

static float sampleMotion(double phase, const MotionCommand& command) {
  if (command.mode == 0) return command.minimum;
  if (command.mode == 2) {
    // Golden Pulse: two equally timed flaps, then a 30% breath.
    if (phase >= 0.70) return command.minimum;
    phase = fmod(phase / 0.35, 1.0);
  }
  const float amount = phase < 0.5
      ? impulseEase(static_cast<float>(phase * 2.0), command.x, command.y)
      : 1.0f - impulseEase(static_cast<float>((phase - 0.5) * 2.0), command.x, command.y);
  return command.minimum + (command.maximum - command.minimum) * amount;
}

static void outputServoAngle(float degrees) {
  if (!servoAttached || !device::configured() || device::updating()) return;
  degrees = clampFloat(degrees, device::limits.minimum, device::limits.maximum);
  const float pulseUs = SERVO_PULSE_MIN_US +
      (SERVO_PULSE_MAX_US - SERVO_PULSE_MIN_US) * degrees / 180.0f;
  constexpr uint32_t maximumDuty = (1UL << SERVO_RESOLUTION_BITS) - 1;
  const uint32_t duty = static_cast<uint32_t>(lroundf(pulseUs * maximumDuty / 20000.0f));
  ledcWrite(SERVO_PIN, duty);
}

static bool attachServo() {
  if (!device::configured() || device::updating() || manual::armed) return false;
  if (servoAttached) return true;
  servoAttached = ledcAttach(SERVO_PIN, SERVO_FREQUENCY_HZ, SERVO_RESOLUTION_BITS);
  if (servoAttached) outputServoAngle(commandedAngle);
  else Serial.println("Servo PWM attach failed; motion remains stopped.");
  return servoAttached;
}

static void detachServo() {
  if (servoAttached) ledcDetach(SERVO_PIN);
  servoAttached = false;
  pinMode(SERVO_PIN, OUTPUT);
  digitalWrite(SERVO_PIN, LOW);
}

static void requestPark(uint32_t now) {
  motion.mode = 0;
  cyclePhase = 0.0;
  const float newTarget = motion.minimum;
  targetAngle = newTarget;
  if (!servoAttached) {
    parkTargetAngle = newTarget;
    parking = false;  // No attach or motion solely because a phone disconnected.
    return;
  }
  if (parking && fabsf(parkTargetAngle - newTarget) < 0.01f) return;
  // Retarget from the current pulse if a new stop changes the minimum angle.
  // Repeated identical stops remain idempotent and do not postpone detachment.
  parkTargetAngle = newTarget;
  parking = true;
  parkStartAngle = commandedAngle;
  parkStartedMs = now;
  parkReachedMs = 0;
}

static void applyCommand(const MotionCommand& command, uint32_t now) {
  if (device::updating() || manual::armed) return;
  if (!device::configured()) { motion.mode = 0; detachServo(); return; }
  if (command.mode == 6 && motion.mode != 6) beforeFlutter = motion;
  motion = command;
  // The saved physical range applies equally to every app and touch preset.
  motion.minimum = device::limits.minimum;
  motion.maximum = device::limits.maximum;
  if (command.mode >= 1 && command.mode <= 5) selectedMode = command.mode;
  cyclePhase = 0.0;
  if (motion.mode == 0) {
    requestPark(now);
    return;
  }
  parking = false;
  if (!attachServo()) {
    motion.mode = 0;
    return;
  }
  lastServoMs = now;
  targetAngle = motion.minimum;
}

static void tickTouch(uint32_t now) {
  const bool blocked = device::updating() || manual::armed || !device::configured();
  const bool raw = digitalRead(TOUCH_PIN) == HIGH;
  if (raw != touchRaw) {
    touchRaw = raw;
    touchChangedMs = now;
  }
  if (raw == touchStable || now - touchChangedMs < TOUCH_DEBOUNCE_MS) return;
  touchStable = raw;
  if (!touchStable) return;  // One mode change per touch, even if held.
  if (blocked) return; // Consume held touches during calibration/update; do not replay them later.

  startupFlapPending = false;
  const uint8_t nextMode = motion.mode >= 1 && motion.mode <= 4
      ? static_cast<uint8_t>(motion.mode + 1) : 1;
  controlSource = ControlSource::Touch;
  if (nextMode == 5) {
    MotionCommand stop = motion;
    stop.mode = 0;
    applyCommand(stop, now);
    Serial.println("Touch: paused.");
  } else {
    applyCommand(TOUCH_PRESETS[nextMode - 1], now);
    Serial.printf("Touch: mode %u.\n", nextMode);
  }
}

static void tickStartupFlap(uint32_t now) {
  if (!startupFlapPending || now - bootStartedMs < STARTUP_FLAP_DELAY_MS) return;
  startupFlapPending = false;
  if (!device::configured() || device::updating() || manual::armed) return;
  if (controlSource != ControlSource::None) return;  // A user command takes priority.

  const uint8_t low = device::limits.minimum;
  const uint8_t high = static_cast<uint8_t>(fminf(device::limits.maximum, low + 10));
  const MotionCommand rest = {0, low, high, 5, 40, 20};
  const MotionCommand greeting = {6, low, high, 5, 40, 20};
  motion = rest;
  commandedAngle = low;
  targetAngle = low;
  applyCommand(greeting, now);  // One 2-second flap, then park and detach.
  motion.maximum = high; // Greeting uses at most 10 degrees of the saved range.
  Serial.println("Power-on greeting: one gentle flap.");
}

static void tickServo(uint32_t now) {
  if (device::updating() || manual::armed || !device::configured()) return;
  const uint32_t elapsed = now - lastServoMs;
  if (elapsed < SERVO_TICK_MS) return;
  lastServoMs = now;

  if (parking) {
    const uint32_t parkElapsed = now - parkStartedMs;
    const float t = clampFloat(parkElapsed / static_cast<float>(PARK_DURATION_MS), 0.0f, 1.0f);
    const float eased = t * t * (3.0f - 2.0f * t);
    const float desired = parkStartAngle + (parkTargetAngle - parkStartAngle) * eased;
    const float step = MAX_SLEW_DEGREES_PER_SECOND * fminf(elapsed, 50) / 1000.0f;
    commandedAngle += clampFloat(desired - commandedAngle, -step, step);
    outputServoAngle(commandedAngle);
    if (parkElapsed >= PARK_DURATION_MS && fabsf(commandedAngle - parkTargetAngle) < .05f) {
      if (!parkReachedMs) parkReachedMs = now;
      if (now - parkReachedMs >= PARK_HOLD_MS) { detachServo(); parking = false; }
    } else parkReachedMs = 0;
    return;
  }
  if (motion.mode == 0 || !servoAttached) return;

  cyclePhase += elapsed * motion.speed / 10000.0;
  if (motion.mode == 6 && cyclePhase >= 1.0) {
    // Restore previous mood after one cycle; repeated flutter restarts the cycle
    // without losing the original mood. A stop/disconnect always takes priority.
    const MotionCommand restore = beforeFlutter;
    applyCommand(restore, now);
    return;
  }
  cyclePhase = fmod(cyclePhase, 1.0);
  targetAngle = clampFloat(sampleMotion(cyclePhase, motion), device::limits.minimum, device::limits.maximum);
  // Target is the curve; commanded is the limited pulse position. Reporting both
  // makes the physical slew limit visible instead of claiming perfect tracking.
  const float maximumStep = MAX_SLEW_DEGREES_PER_SECOND * fminf(elapsed, 50) / 1000.0f;
  commandedAngle += clampFloat(targetAngle - commandedAngle, -maximumStep, maximumStep);
  outputServoAngle(commandedAngle);
}

static void tickBattery(uint32_t now) {
  if (now - lastBatteryMs < BATTERY_PERIOD_MS) return;
  lastBatteryMs = now;
#if WOH_ENABLE_RUNTIME_BATTERY_ESTIMATE
  static_assert(ESTIMATE_CAPACITY_MAH > 0.0f, "Calibrated capacity must be positive");
  batteryPercent = static_cast<uint8_t>(lroundf(clampFloat(
      ESTIMATE_INITIAL_PERCENT - estimatedConsumedMah * 100.0 / ESTIMATE_CAPACITY_MAH,
      0.0f, 100.0f)));
  batteryKind = 1;  // Runtime estimate; never a measured battery-health signal.
#else
  batteryPercent = 255;
  batteryKind = 0;
#endif
}

static void sendTelemetry(uint32_t now, bool connected) {
  if (now - lastTelemetryMs < TELEMETRY_PERIOD_MS) return;
  lastTelemetryMs = now;
  if (!connected || telemetryCharacteristic == nullptr) return;
  const uint32_t uptimeSeconds = static_cast<uint32_t>(uptimeMs / 1000ULL);
  uint8_t packet[19] = {
    0x57, 2, telemetrySequence++, motion.mode,
    static_cast<uint8_t>(lroundf(commandedAngle)),
    static_cast<uint8_t>(lroundf(targetAngle)), batteryPercent, batteryKind,
    static_cast<uint8_t>(uptimeSeconds), static_cast<uint8_t>(uptimeSeconds >> 8),
    static_cast<uint8_t>(uptimeSeconds >> 16), static_cast<uint8_t>(uptimeSeconds >> 24),
    static_cast<uint8_t>((motion.mode != 0 ? 1 : 0) | (servoAttached ? 2 : 0)),
    motion.speed, motion.x, motion.y, motion.minimum, motion.maximum, selectedMode
  };
  telemetryCharacteristic->setValue(packet, sizeof(packet));
  telemetryCharacteristic->notify();  // 19 bytes fits the default 23-byte ATT MTU.
}

class WingServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    bool accepted;
    portENTER_CRITICAL(&mailboxMux);
    accepted = activeConnection == NO_CONNECTION;
    if (accepted) activeConnection = info.getConnHandle();
    portEXIT_CRITICAL(&mailboxMux);
    if (!accepted) {
      server->disconnect(info.getConnHandle());
      return;
    }
    server->updateConnParams(info.getConnHandle(), 12, 24, 0, 200);
    Serial.println("Wings companion connected.");
  }

  void onDisconnect(NimBLEServer*, NimBLEConnInfo& info, int) override {
    bool wasActive = false;
    portENTER_CRITICAL(&mailboxMux);
    if (activeConnection == info.getConnHandle()) {
      activeConnection = NO_CONNECTION;
      mailboxPending = false;
      mailboxDisconnected = true;
      wasActive = true;
    }
    portEXIT_CRITICAL(&mailboxMux);
    if (wasActive) {
      device::onDisconnect();
      NimBLEDevice::startAdvertising();
      Serial.println("Disconnected; park requested, advertising restarted.");
    }
  }
};

class WingCommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& info) override {
    const NimBLEAttValue value = characteristic->getValue();
    MotionCommand decoded;
    if (!decodeCommand(value.data(), value.size(), decoded)) {
      Serial.println("Rejected malformed motion packet.");
      return;
    }
    portENTER_CRITICAL(&mailboxMux);
    if (activeConnection == info.getConnHandle()) {
      // Latest valid command wins; servo work never runs in the BLE callback.
      mailboxCommand = decoded;
      mailboxPending = true;
    }
    portEXIT_CRITICAL(&mailboxMux);
  }
};

static WingServerCallbacks serverCallbacks;
static WingCommandCallbacks commandCallbacks;

static bool authorizedDeviceConnection(uint16_t handle) {
  portENTER_CRITICAL(&mailboxMux);
  const bool valid = activeConnection == handle;
  portEXIT_CRITICAL(&mailboxMux);
  return valid;
}
static void pauseAllMotion() {
  startupFlapPending = false;
  manual::stop();
  detachServo();
  parking = false; motion.mode = 0;
  controlSource = ControlSource::None;
  portENTER_CRITICAL(&mailboxMux);
  mailboxPending = false;
  portEXIT_CRITICAL(&mailboxMux);
}

void setup() {
  Serial.begin(115200);
  detachServo();  // No PWM during the two-second startup wait.
  device::loadLimits();
  if (device::configured()) {
    motion.minimum = device::limits.minimum; motion.maximum = device::limits.maximum;
    commandedAngle = targetAngle = motion.minimum;
  }
  manual::begin(pauseAllMotion);
  pinMode(TOUCH_PIN, INPUT_PULLDOWN);
  touchRaw = touchStable = digitalRead(TOUCH_PIN) == HIGH;
  touchChangedMs = millis();
  NimBLEDevice::init("WingsOnHair");
  NimBLEDevice::setMTU(247);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCallbacks);
  NimBLEService* service = server->createService(SERVICE_UUID);
  NimBLECharacteristic* command = service->createCharacteristic(COMMAND_UUID, NIMBLE_PROPERTY::WRITE, 6);
  command->setCallbacks(&commandCallbacks);
  telemetryCharacteristic = service->createCharacteristic(
      TELEMETRY_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY, 19);
  const uint8_t initialTelemetry[19] = {0x57, 2, 0, 0, 15, 15, 255, 0, 0, 0, 0, 0, 0, 8, 35, 65, 15, 85, 1};
  telemetryCharacteristic->setValue(initialTelemetry, sizeof(initialTelemetry));
  device::begin(service, authorizedDeviceConnection, pauseAllMotion);
  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->enableScanResponse(true);
  advertising->setName("WingsOnHair");
  advertising->start();
  lastLoopMs = millis();
  lastServoMs = lastLoopMs;
  bootStartedMs = lastLoopMs;
  Serial.println("Wings On Hair ready. Greeting flap in two seconds.");
}

void loop() {
  const uint32_t now = millis();
  const uint32_t elapsed = now - lastLoopMs;  // Unsigned difference handles rollover.
  lastLoopMs = now;
  uptimeMs += elapsed;
  device::poll(now);
  manual::poll();
  if (device::rangeChanged) {
    device::rangeChanged = false;
    motion.minimum = device::limits.minimum; motion.maximum = device::limits.maximum;
    commandedAngle = targetAngle = motion.minimum;
  }
#if WOH_ENABLE_RUNTIME_BATTERY_ESTIMATE
  const float estimatedCurrent = ESTIMATE_IDLE_MA + (servoAttached ? ESTIMATE_SERVO_EXTRA_MA : 0.0f);
  estimatedConsumedMah += estimatedCurrent * elapsed / 3600000.0;
#endif

  MotionCommand nextCommand;
  bool hasCommand;
  bool disconnected;
  bool connected;
  portENTER_CRITICAL(&mailboxMux);
  hasCommand = mailboxPending;
  if (hasCommand) nextCommand = mailboxCommand;
  mailboxPending = false;
  disconnected = mailboxDisconnected;
  mailboxDisconnected = false;
  connected = activeConnection != NO_CONNECTION;
  portEXIT_CRITICAL(&mailboxMux);

  if ((disconnected || !connected) && controlSource == ControlSource::Phone) {
    if (motion.mode != 0) requestPark(now);
    controlSource = ControlSource::None;
  }
  if (hasCommand && connected) {
    startupFlapPending = false;
    controlSource = ControlSource::Phone;
    applyCommand(nextCommand, now);
  }
  tickTouch(now);
  tickStartupFlap(now);
  tickServo(now);
  tickBattery(now);
  sendTelemetry(now, connected);
  yield();  // Cooperative, non-blocking loop; no delay() or servo sweep loops.
}
