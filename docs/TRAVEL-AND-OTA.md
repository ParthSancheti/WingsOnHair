# Saved wing travel and wireless firmware updates

## The one-time USB update

The v2.6 firmware cannot save a travel range or receive OTA images. Install the v2.7 APK, then upload the v2.7 main sketch once over USB. Choose **ESP32C3 Dev Module**, Arduino-ESP32 3.3.12 and NimBLE-Arduino 2.5.2. Keep the default 4 MB partition layout with two OTA app slots. Installing the v2.7 source with a huge-app/no-OTA partition layout will prevent wireless updates.

Fresh devices do not move until a range is explicitly saved. The device loads its NVS range before allowing motion. Bad/missing configuration is treated as unconfigured. Updating the app or connecting a different phone does not replace the saved angles. A normal app-only OTA update retains NVS; erasing flash or changing partition layouts can remove those settings.

## Use the manual USB slider

1. Install Python with Tk support and pyserial: `python -m pip install pyserial`. On the builder's PC, pyserial is also available in the project's ignored `.tools/serial-runtime` folder.
2. Upload `firmware/WingsOnHair_Firmware/WingsOnHair_Firmware.ino`. Close Arduino Serial Monitor so it does not hold the COM port.
3. Run `powershell -File scripts/open-slider.ps1`, or `pythonw scripts/servo-slider.py`.
4. Click Refresh and Connect USB. Connecting sends STOP and reads status; it does not enable the motor.
5. Choose the previous mode whose starting position worked. The old programmed starts were: power-on resting position 45°, Calm 25°, Pulse 20°, Energy 15°, Night 35°. These are servo command angles, not measured physical wing angles. **Do not guess which one matches your mechanism.** If unsure, leave output off and inspect the linkage before enabling.
6. Click **Move to this starting position**. This first pulse sets an absolute position; software cannot know the unpowered shaft's starting angle. Later endpoint changes slew at 5 commanded degrees/second.
7. Use the endpoint slider or ±1° buttons. The chosen start stays locked. Return to start and One gentle flap let you check the smaller range. STOP or Escape removes PWM. Changing the start requires stopping first. Disconnecting or closing the tool removes PWM after the host heartbeat times out (about one second).
8. Once movement is free of binding, choose **Save for all modes**. The device pauses, saves the range and replies `SAVED start end`. The app can read those values on the next connection. A copy is recorded on the PC at `.tools/chosen-wing-angles.json` after acknowledgement.

The same range applies to both mechanically linked wings. It cannot separately correct left/right gear geometry. Saved ranges change commanded motion; there is no load sensor or physical angle feedback. Detaching the signal stops commanded holding torque but does not switch off servo power.

The old `WingTravelTest` sketch is not the slider firmware. Do not re-upload the old automatic 90°–100° test. Use the main v2.7 sketch and the manual slider.

## App: Wing travel

Tap the logo → Wing travel. Values are read from the connected butterfly. Edit the start and end you already checked, then Save on butterfly. The app waits for a successful device acknowledgement before reporting success. Dragging these app sliders does not move the motor. Saving pauses motion. A fresh/unconfigured butterfly will reject Start, touch presets and startup motion until the range is set.

All preset commands are constrained to the stored range inside the firmware, including commands from older clients. Firmware overwrites incoming per-mode angle bounds with the saved physical endpoints. Speed and easing remain mode-specific. The greeting uses no more than ten degrees inside the configured range. The final PWM write is also bounded.

## App: Update butterfly

The app downloads the latest public release's `firmware-manifest.json`, verifies its signature, downloads the app-only binary, checks its size/chip/hash, then transfers it over BLE with progress and acknowledgement of each chunk. The ESP32 independently verifies the signature and image hash before activating the inactive OTA slot. Motion is disabled before transfer begins; touch and normal commands cannot resume it during the update.

Keep the app in the foreground. Backgrounding/cancelling aborts the transfer. A 30-second device receive timeout or Bluetooth disconnect also aborts an incomplete image. The active slot remains selected until a complete image passes validation. The device restarts after commit; reconnect to read and confirm its firmware version. Stored angles are separate from the app slots and survive normal wireless updates.

Stock Arduino core builds do not provide automatic boot health rollback. Signature/hash verification prevents corrupt or unauthorized firmware, but a correctly signed program can still contain bugs. USB recovery remains available. Hardware OTA and power-interruption acceptance checks are still pending on the builder's assembled device.

## Publish your next firmware release

1. Back up the private signing key privately. The builder's key is in ignored `.tools/signing/firmware-private.pem`; it is never included in the source ZIP or GitHub. Losing it requires provisioning a new trusted public key by USB. Do not regenerate it for each release.
2. Fork builders create their own key once with `node scripts/prepare-ota-key.mjs`. This writes the public key used by both app and firmware. Existing devices trust their provisioned key, so changing keys requires a new USB installation.
3. Update package version, Android versionCode, firmware `VERSION_CODE` and docs. Firmware versionCode is `major * 10000 + minor * 100 + patch`, each component 0–99. Android's app versionCode is managed separately.
4. Compile the ESP32-C3 main sketch and build the APK. Use the app-only `.ino.bin`, **never the merged image**, for OTA.
5. Run `node scripts/sign-firmware.mjs path/to/WingsOnHair_Firmware.ino.bin releases path/to/private-key.pem`. If no key path is provided, the local ignored key is used; `WOH_FIRMWARE_SIGNING_KEY` can provide an alternate path.
6. Attach `firmware-manifest.json` and the exact `WingsOnHair-vVERSION-esp32c3-ota.bin` it names to the matching GitHub release, alongside the APK/source/USB package. Publish a stable version tag such as `v2.8.0`. A commit alone does not trigger an app update.

The manifest authenticates board ID, monotonic firmware versionCode, image size and SHA-256. P-256 signatures use 64-byte IEEE P1363 form in the manifest; the ESP32 converts this to ASN.1 DER for mbedTLS verification. App and firmware embed only the public key. OTA writes only an inactive application slot; it does not overwrite the bootloader, partition table, or NVS.
