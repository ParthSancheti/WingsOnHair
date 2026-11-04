# Wings On Hair 2.7.1 — Confirmed wing travel

The assembled butterfly's owner confirmed **45° rest/start and 113° flap end** after a live mechanical test. These endpoints are saved inside that ESP32-C3 and apply to every app mode, touch mode, single flutter, parking and restart. The startup greeting remains a smaller sweep within the saved range. No automatic 130° calibration test is included in this release.

The previous app and normal firmware rejected values above 110°, including valid 113° telemetry. This patch extends range validation, BLE decoding, command encoding, saved settings and the app's travel control to 130°. Existing preset curves and speeds remain unchanged; the device's saved endpoints override each preset's angle range. The owner's saved cap is 113°, not 130°.

**Install the matching v2.7.1 APK before connecting to a butterfly configured above 110°.** APK installation remains manual; the app's release alert links to this download. The signed firmware package can be sent through About → Update butterfly on compatible v2.7+ firmware, or uploaded once using ESP32C3 Dev Module in Arduino IDE. Use the default 4 MB OTA-capable partitions. A normal sketch upload or app-only OTA preserves saved angles; a full merged image overwrites settings.

Fresh devices still have no enabled default movement range: each builder must save angles tested on their own mechanism. The 45°–113° result is specific to this assembly, not a guarantee for other gear arrangements. GPIO4 (servo) and GPIO3 (active-high 3.3 V touch sensor) remain unchanged.

All v2.7 sync, estimated 150 mAh battery display and signed GitHub BLE firmware update features remain included. The battery is a runtime estimate, not a voltage measurement. A complete physical OTA transfer and power-interruption recovery test remain unverified; no automatic boot-health rollback is claimed.

Source includes regression coverage for saving 45°–113°, reconnecting with those settings, and decoding/encoding motion above the old 110° boundary. See [travel and OTA setup](TRAVEL-AND-OTA.md) for installation and wiring references.
