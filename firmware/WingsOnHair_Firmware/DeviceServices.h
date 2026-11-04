#pragma once
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include "ota_public_key.h"

namespace device {
constexpr uint32_t VERSION_CODE = 20700; // major * 10000 + minor * 100 + patch.
constexpr char SETTINGS_UUID[] = "7a1b0004-6e3d-4b7a-9c21-8f5d0a2e6c10";
constexpr char OTA_CONTROL_UUID[] = "7a1b0005-6e3d-4b7a-9c21-8f5d0a2e6c10";
constexpr char OTA_DATA_UUID[] = "7a1b0006-6e3d-4b7a-9c21-8f5d0a2e6c10";
struct Limits { uint8_t schema, minimum, maximum, checksum; };
static Limits limits = {0, 25, 45, 0}; // Unconfigured: main firmware must not move.
static Preferences preferences;
static bool preferencesReady = false;
static bool rangeChanged = false;
static NimBLECharacteristic *settingsChar = nullptr, *otaChar = nullptr;
static bool (*authorized)(uint16_t) = nullptr;
static void (*pauseMotion)() = nullptr;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static uint8_t pendingSettings[6], pendingControl[9], pendingData[244];
static uint16_t dataLength = 0;
static uint8_t controlLength = 0;
static bool settingsPending = false, dataPending = false, disconnected = false, overflow = false;
static uint8_t settingsError = 0;
static uint16_t settingsToken = 0;
// OTA status: 0 idle, 1 signed metadata, 2 image, 3 ready, 4 committed, 5 error.
static uint8_t otaPhase = 0, otaError = 0;
static uint32_t streamOffset = 0, imageSize = 0, imageVersion = 0, lastOtaMs = 0, restartAt = 0;
static uint8_t metadata[96] = {};
static esp_ota_handle_t otaHandle = 0;
static bool otaOpen = false;
static const esp_partition_t* otaPartition = nullptr;
static mbedtls_sha256_context imageHash;

static uint32_t read32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0]) | (static_cast<uint32_t>(bytes[1]) << 8) |
      (static_cast<uint32_t>(bytes[2]) << 16) | (static_cast<uint32_t>(bytes[3]) << 24);
}
static void write32(uint8_t* bytes, uint32_t value) {
  for (uint8_t i = 0; i < 4; ++i) bytes[i] = value >> (8 * i);
}
static bool validLimits(uint8_t minimum, uint8_t maximum) { return minimum >= 15 && maximum <= 110 && minimum < maximum; }
static bool configured() { return limits.schema == 1 && validLimits(limits.minimum, limits.maximum); }
static bool updating() { return otaPhase >= 1 && otaPhase <= 4; }
static void publishSettings() {
  if (!settingsChar) return;
  uint8_t bytes[14] = {0x4c, 1, static_cast<uint8_t>(configured()), limits.minimum, limits.maximum,
      settingsError, static_cast<uint8_t>(settingsToken), static_cast<uint8_t>(settingsToken >> 8), 0, 0, 0, 0, 1, 0};
  write32(bytes + 8, VERSION_CODE);
  settingsChar->setValue(bytes, sizeof(bytes));
}
static void publishOta() {
  if (!otaChar) return;
  uint8_t bytes[16] = {0x4f, 1, otaPhase, otaError};
  write32(bytes + 4, streamOffset); write32(bytes + 8, imageSize); write32(bytes + 12, imageVersion);
  otaChar->setValue(bytes, sizeof(bytes));
}
static void loadLimits() {
  preferencesReady = preferences.begin("woh-travel", false);
  if (preferencesReady && preferences.getBytesLength("limits") == sizeof(Limits)) {
    Limits stored;
    preferences.getBytes("limits", &stored, sizeof(stored));
    if (stored.schema == 1 && validLimits(stored.minimum, stored.maximum) &&
        stored.checksum == (0xa5 ^ stored.schema ^ stored.minimum ^ stored.maximum)) limits = stored;
  }
}
static bool saveLimits(uint8_t minimum, uint8_t maximum) {
  if (!validLimits(minimum, maximum)) { settingsError = 1; return false; }
  if (pauseMotion) pauseMotion();
  Limits next = {1, minimum, maximum, static_cast<uint8_t>(0xa5 ^ 1 ^ minimum ^ maximum)};
  if (!preferencesReady || preferences.putBytes("limits", &next, sizeof(next)) != sizeof(next)) { settingsError = 2; return false; }
  limits = next; settingsError = 0; rangeChanged = true;
  publishSettings();
  return true;
}
static void abortOta(uint8_t error) {
  if (otaOpen) esp_ota_abort(otaHandle);
  otaOpen = false;
  mbedtls_sha256_free(&imageHash);
  otaPhase = error ? 5 : 0; otaError = error; restartAt = 0;
  publishOta();
}
static bool verifySignature() {
  char hex[65];
  for (uint8_t i = 0; i < 32; ++i) snprintf(hex + 2 * i, 3, "%02x", metadata[i]);
  const String payload = String("WingsOnHair-ESP32C3:") + imageVersion + ":" + imageSize + ":" + hex;
  uint8_t digest[32];
  if (mbedtls_sha256(reinterpret_cast<const uint8_t*>(payload.c_str()), payload.length(), digest, 0)) return false;
  // Convert the fixed 64-byte P1363 signature to ASN.1 DER for mbedTLS.
  uint8_t der[72]; size_t length = 2;
  for (uint8_t component = 0; component < 2; ++component) {
    const uint8_t* number = metadata + 32 + component * 32;
    size_t skip = 0; while (skip < 31 && number[skip] == 0) ++skip;
    const bool prefix = (number[skip] & 0x80) != 0;
    der[length++] = 2; der[length++] = 32 - skip + (prefix ? 1 : 0);
    if (prefix) der[length++] = 0;
    memcpy(der + length, number + skip, 32 - skip); length += 32 - skip;
  }
  der[0] = 0x30; der[1] = length - 2;
  mbedtls_pk_context key; mbedtls_pk_init(&key);
  const bool valid = mbedtls_pk_parse_public_key(&key, reinterpret_cast<const uint8_t*>(OTA_PUBLIC_KEY), sizeof(OTA_PUBLIC_KEY)) == 0 &&
      mbedtls_pk_verify(&key, MBEDTLS_MD_SHA256, digest, sizeof(digest), der, length) == 0;
  mbedtls_pk_free(&key);
  return valid;
}
static void processControl(const uint8_t* bytes, uint8_t length, uint32_t now) {
  if (otaPhase == 4) return;
  if (bytes[0] == 3 && length == 1) { if (otaPhase != 4) abortOta(0); return; }
  if (bytes[0] == 1 && length == 9) {
    if (otaPhase == 4) return;
    if (pauseMotion) pauseMotion();
    abortOta(0);
    imageSize = read32(bytes + 1); imageVersion = read32(bytes + 5);
    otaPartition = esp_ota_get_next_update_partition(nullptr);
    if (!otaPartition || imageSize < 256 || imageSize > otaPartition->size || imageVersion < VERSION_CODE) { abortOta(1); return; }
    streamOffset = 0; otaPhase = 1; otaError = 0; lastOtaMs = now;
    memset(metadata, 0, sizeof(metadata));
    publishOta(); return;
  }
  if (bytes[0] == 2 && length == 1 && otaPhase == 3 && streamOffset == imageSize + 96) {
    uint8_t actual[32];
    if (mbedtls_sha256_finish(&imageHash, actual) || memcmp(actual, metadata, 32)) { abortOta(2); return; }
    const esp_err_t ended = esp_ota_end(otaHandle);
    otaOpen = false; mbedtls_sha256_free(&imageHash);
    if (ended != ESP_OK || esp_ota_set_boot_partition(otaPartition) != ESP_OK) { abortOta(3); return; }
    otaPhase = 4; restartAt = now + 1500; publishOta(); return;
  }
  abortOta(4);
}
static void processData(const uint8_t* bytes, uint16_t length, uint32_t now) {
  if (otaPhase == 4) return;
  if (otaPhase != 1 && otaPhase != 2) { abortOta(4); return; }
  if (length <= 4 || read32(bytes) != streamOffset || streamOffset + length - 4 > imageSize + 96) { abortOta(4); return; }
  const uint8_t* data = bytes + 4; size_t count = length - 4;
  if (streamOffset < 96) {
    const size_t take = count < 96 - streamOffset ? count : 96 - streamOffset;
    memcpy(metadata + streamOffset, data, take);
    streamOffset += take; data += take; count -= take;
    if (streamOffset == 96) {
      if (!verifySignature()) { abortOta(2); return; }
      if (esp_ota_begin(otaPartition, imageSize, &otaHandle) != ESP_OK) { abortOta(3); return; }
      otaOpen = true;
      mbedtls_sha256_init(&imageHash);
      if (mbedtls_sha256_starts(&imageHash, 0)) { abortOta(3); return; }
      otaPhase = 2;
    }
  }
  if (count) {
    if (!otaOpen || esp_ota_write(otaHandle, data, count) != ESP_OK || mbedtls_sha256_update(&imageHash, data, count)) { abortOta(3); return; }
    streamOffset += count;
  }
  if (streamOffset == imageSize + 96) otaPhase = 3;
  lastOtaMs = now; publishOta();
}
class Callbacks : public NimBLECharacteristicCallbacks {
 public:
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& info) override {
    if (!authorized || !authorized(info.getConnHandle())) return;
    const NimBLEAttValue value = characteristic->getValue();
    portENTER_CRITICAL(&mux);
    if (characteristic == settingsChar) {
      if (value.size() == 6) { memcpy(pendingSettings, value.data(), 6); settingsPending = true; }
    } else if (characteristic == otaChar) {
      if ((value.size() == 1 || value.size() == 9) && controlLength == 0) { memcpy(pendingControl, value.data(), value.size()); controlLength = value.size(); }
      else overflow = true;
    } else {
      if (value.size() > 4 && value.size() <= sizeof(pendingData) && !dataPending) { memcpy(pendingData, value.data(), value.size()); dataLength = value.size(); dataPending = true; }
      else overflow = true;
    }
    portEXIT_CRITICAL(&mux);
  }
};
static Callbacks callbacks;
static void begin(NimBLEService* service, bool (*auth)(uint16_t), void (*pause)()) {
  authorized = auth; pauseMotion = pause;
  settingsChar = service->createCharacteristic(SETTINGS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE, 20);
  otaChar = service->createCharacteristic(OTA_CONTROL_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE, 20);
  auto* data = service->createCharacteristic(OTA_DATA_UUID, NIMBLE_PROPERTY::WRITE, 244);
  settingsChar->setCallbacks(&callbacks); otaChar->setCallbacks(&callbacks); data->setCallbacks(&callbacks);
  publishSettings(); publishOta();
}
static void onDisconnect() { portENTER_CRITICAL(&mux); disconnected = true; portEXIT_CRITICAL(&mux); }
static void poll(uint32_t now) {
  uint8_t config[6], control[9], data[244], controlSize = 0;
  uint16_t count = 0; bool hasSettings, lost, invalid;
  portENTER_CRITICAL(&mux);
  hasSettings = settingsPending; if (hasSettings) memcpy(config, pendingSettings, 6);
  settingsPending = false; controlSize = controlLength; controlLength = 0;
  if (controlSize) memcpy(control, pendingControl, controlSize);
  if (dataPending) { count = dataLength; memcpy(data, pendingData, count); } dataPending = false;
  lost = disconnected; disconnected = false; invalid = overflow; overflow = false;
  portEXIT_CRITICAL(&mux);
  if ((lost || invalid) && updating() && otaPhase != 4) { abortOta(lost ? 6 : 4); return; }
  if (lost) return; // Discard all queued writes from a disconnected session.
  if (controlSize) processControl(control, controlSize, now);
  if (count) processData(data, count, now);
  if (hasSettings && !updating()) {
    settingsToken = config[4] | (static_cast<uint16_t>(config[5]) << 8);
    if (config[0] == 0x4c && config[1] == 1) saveLimits(config[2], config[3]); else settingsError = 1;
    publishSettings();
  }
  if (updating() && otaPhase != 4 && now - lastOtaMs > 30000) abortOta(5);
  if (restartAt && static_cast<int32_t>(now - restartAt) >= 0) ESP.restart();
}
} // namespace device
