# Wings On Hair 2.7 — Remember your wings

Save one tested movement range inside the ESP32-C3 and keep it after power-off. The saved start and end apply to all app modes, touch modes, one-flutter actions, parking and the startup greeting. One servo drives both linked wings; the two wings are not independently controlled.

**This build deliberately has no untested default movement range. A fresh installation keeps the motor signal off until you save your mechanically tested angles.** The builder's attempted 90°–100° test changed the starting position and strained the mechanism; that range has not been adopted. The original starting position must be identified before choosing a shorter end angle.

## Install once over USB

1. Install `WingsOnHair-v2.7-debug.apk` from this release. This is a debug-signed personal prototype build.
2. Open `firmware/WingsOnHair_Firmware/WingsOnHair_Firmware.ino` from the source package in Arduino IDE. Select **ESP32C3 Dev Module** and the board's actual COM port. Do not select ESP32-S3 or Ozobot DRVKit.
3. Use Arduino-ESP32 **3.3.12**, NimBLE-Arduino **2.5.2**, and the default **4 MB / default OTA-capable partition scheme**. Upload the sketch. The precompiled USB bundle uses the same configuration.
4. There is no movement until the range is configured. GPIO4 remains servo signal; GPIO3 remains the 3.3 V active-high touch sensor input.

## Find the endpoint on your PC

See [the USB slider guide](TRAVEL-AND-OTA.md). Open `scripts/open-slider.ps1` with PowerShell, or run `pythonw scripts/servo-slider.py` after installing pyserial. Connect USB, select the old mode whose starting position worked, then explicitly enable at that position. Only then does the endpoint slider become active. Move in one-degree steps and stop immediately if binding occurs. The first command is an absolute servo position; the servo cannot report its actual mechanical angle.

The slider moves later commands at 5 commanded degrees per second. STOP removes PWM immediately; Escape, closing the slider, losing USB or missing its heartbeat also stops the signal. Saving the final range stops movement and writes the angles into the butterfly. Saved angles are reused without an app rebuild or another firmware flash. Detaching PWM does not remove the servo's power supply.

## App controls

Tap the app logo → **Wing travel**. Enter the start and end you tested, then **Save on butterfly**. The app waits for the device's save acknowledgement. These app sliders edit values without moving the motor. Saving pauses the wings. Preset speeds and curves still differ, while every preset uses the same physical range. The startup greeting uses at most the first ten degrees of that range.

## Wireless firmware updates from GitHub

After this first USB installation, tap the app logo → **Update butterfly** → **Check GitHub**. When a newer compatible firmware package is published, choose **Download & update butterfly**. The phone downloads the GitHub image and transfers it over Bluetooth; the butterfly does not need Wi-Fi credentials. Keep the app open and both devices powered nearby.

The app and ESP32 verify the firmware's SHA-256 hash and P-256 signature. The ESP32 writes to the inactive application slot and changes the boot partition only after verifying the completed image. Motion is disabled during transfer. Cancellation, disconnection or transfer timeout aborts an incomplete update; it does not switch the boot partition. Saved limits remain in NVS. Only the app-only OTA `.bin` is suitable for wireless transfer; a merged USB image is not.

Firmware updates require an explicit action. App APK updates still show an in-app alert and a download link; Android installation is manual. There is no silent APK install or background Android push notification. ESP32 v2.6 cannot gain OTA or persistent limits without one USB flash.

## Verification and remaining hardware checks

The source includes service tests for range validation, acknowledgements, signature and hash rejection, OTA ordering, cancellation and disconnects, plus browser checks for the new controls. Firmware compilation and APK builds are checked by the build workflow. The ESP32 was disconnected during this release preparation: mechanical range, saved-limit reboot behavior on the assembled device, and a complete Bluetooth firmware upgrade still need the real device test. No claim is made that software can measure gear load or guarantee a particular angle is mechanically safe. Automatic rollback from a bad but correctly signed image is not enabled by the stock bootloader; the previous slot protects against incomplete transfers, not every possible firmware bug.

The 150 mAh battery display remains a labelled runtime estimate, assumes full charge at boot and resets after restart. It does not measure charge or protect the battery.
