#pragma once
#include <HWCDC.h>
namespace manual {
#if ARDUINO_USB_CDC_ON_BOOT
static HWCDC& console = HWCDCSerial;
#else
static HWCDC console;
#endif
static bool armed = false;
static float rest = 45, angle = 45, target = 45, end = 45;
static uint8_t stage = 0;
static uint32_t lastTick = 0, heartbeat = 0;
static char line[40] = {};
static uint8_t length = 0;
static bool overflow = false;
static void (*pauseMotion)() = nullptr;
static void stop() {
  if (armed) ledcDetach(4);
  armed = false; stage = 0;
  pinMode(4, OUTPUT); digitalWrite(4, LOW);
}
static void status() { console.printf("SAFEUSB 1 %s REST %.0f COMMAND %.1f TARGET %.0f\n", armed ? "ON" : "OFF", rest, angle, target); }
static void writeAngle() {
  angle = fmaxf(rest, fminf(130.0f, angle));
  const float pulse = 600 + 1800 * angle / 180;
  ledcWrite(4, static_cast<uint32_t>(lroundf(pulse * ((1UL << 14) - 1) / 20000)));
}
static void command() {
  line[length] = '\0';
  if (!strcmp(line, "STOP")) { if (pauseMotion) pauseMotion(); stop(); status(); return; }
  if (!strcmp(line, "STATUS")) { status(); return; }
  if (!strcmp(line, "PING")) { heartbeat = millis(); return; }
  if (device::updating()) { console.println("ERROR Firmware update in progress"); return; }
  if (!strcmp(line, "REST")) { if (armed) { stage = 0; target = rest; heartbeat = millis(); } return; }
  const bool arm = !strncmp(line, "ARM ", 4), move = !strncmp(line, "END ", 4), flap = !strncmp(line, "FLAP ", 5);
  if (!strncmp(line, "SAVE ", 5)) {
    char* second = nullptr; const long first = strtol(line + 5, &second, 10);
    if (second == line + 5 || *second != ' ') { console.println("ERROR Invalid range"); return; }
    char* tail = nullptr; const long last = strtol(second + 1, &tail, 10);
    if (tail == second + 1 || *tail || first < 15 || last > 130 || first >= last) { console.println("ERROR Invalid range"); return; }
    stop();
    if (device::saveLimits(first, last)) console.printf("SAVED %ld %ld\n", first, last);
    else console.println("ERROR Save failed");
    status(); return;
  }
  if (!arm && !move && !flap) { console.println("ERROR Unknown command"); return; }
  const char* value = line + (flap ? 5 : 4); char* tail = nullptr;
  const long degrees = strtol(value, &tail, 10);
  if (tail == value || *tail || degrees < 15 || degrees > 130) { console.println("ERROR Angle must be 15-130"); return; }
  if (arm) {
    if (armed) { console.println("ERROR STOP before changing start"); return; }
    if (pauseMotion) pauseMotion();
    rest = angle = target = degrees;
    armed = ledcAttach(4, 50, 14);
    if (!armed) { console.println("ERROR PWM attach failed"); return; }
    writeAngle(); lastTick = millis(); // First pulse commands the explicitly chosen old rest.
  } else {
    if (!armed || degrees < rest) { console.println("ERROR End below start or motor off"); return; }
    end = degrees; stage = flap ? 1 : 0; target = flap ? rest : end;
  }
  heartbeat = millis(); status();
}
static void begin(void (*pause)()) { pauseMotion = pause; console.begin(115200); }
static void poll() {
  while (console.available()) {
    const char c = console.read(); if (c == '\r') continue;
    if (c == '\n') { if (!overflow) command(); else { stop(); console.println("ERROR Command too long"); } length = 0; overflow = false; }
    else if (!overflow && length < sizeof(line) - 1) line[length++] = c; else overflow = true;
  }
  const uint32_t now = millis();
  if (armed && (!console || now - heartbeat > 1000 || device::updating())) { stop(); status(); }
  if (armed && now - lastTick >= 20) {
    const float step = 5.0f * fminf(now - lastTick, 40) / 1000;
    lastTick = now; angle += fmaxf(-step, fminf(step, target - angle)); writeAngle();
    if (fabsf(target - angle) < .01f && stage) {
      if (stage == 1) { target = end; stage = 2; }
      else if (stage == 2) { target = rest; stage = 3; }
      else { stop(); status(); }
    }
  }
}
} // namespace manual
