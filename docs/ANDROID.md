# Android build and device guide

Wings On Hair uses Capacitor 8, a Vite web bundle, Android API 36, and native Bluetooth LE, App, Haptics, and Status Bar support. The refreshed interface is one screen with four modes, Start/Pause, a speed sheet, and local long-press previews. The app ID is `com.parthsancheti.wingsonhair`; Android version name is `2.6.0` and version code is `260`.

## Prerequisites

- Node.js 22.12 or later; Node 24 LTS is recommended.
- Android Studio with Android API 36 support.
- JDK 21. Select it as Android Studio's Gradle JDK, or set `JAVA_HOME` in your terminal. A JDK newer than the Gradle wrapper supports can also fail; do not assume every bundled Studio JDK is compatible.
- Android SDK Platform 36 and Build Tools 36.0.0. Accept the SDK licenses in Android Studio's SDK Manager.
- An Android 7.0 / API 24 or newer phone with Bluetooth LE. Real hardware is required for meaningful Bluetooth, native haptics, system-bar, and accessory verification.

## Install and run

From the repository root:

```powershell
npm ci
npm test
npm run build
npx cap sync android
npx cap open android
```

The Android project is included. Do not run `cap add android` over it. Select a connected phone in Android Studio and run the app.

On Windows, the simplest terminal build is:

```powershell
npm run android:build
```

The helper first checks whether `JAVA_HOME` points to JDK 21; otherwise it checks installed `jdk-21*` folders in `%LOCALAPPDATA%\WingsOnHair\tools`. For the SDK it checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `%LOCALAPPDATA%\Android\Sdk`, requiring Platform 36. It rebuilds the web assets, syncs Capacitor, and assembles the debug APK. Missing prerequisites produce an actionable error; the script does not download Java or an SDK.

The command uses `RemoteSigned` only for its child PowerShell process so the locally authored helper can run even when the terminal's default policy is Restricted. It does not modify the machine or user's execution policy. Java/SDK environment values are restored on completion. The helper also selects a short socket temporary directory to avoid the Windows issue described below; set `WOH_JAVA_SOCKET_DIR` to another short absolute directory only if your project path is unusually long.

To generate the debug APK from a terminal:

```powershell
# Set these to your local installations; they apply only to this terminal.
$env:JAVA_HOME = 'C:\path\to\jdk-21'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npm run build
npx cap sync android
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

The result is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with Android Studio or `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`. After an interface change, rebuild and sync before installing; an older APK retains the older web bundle even when the source files have changed. This is a debug build, not a signed Play Store release. For a distributable release, create and securely retain a signing key using Android Studio's **Generate Signed App Bundle / APK** flow. Never commit a signing key or its password.

If a Windows packaged-app terminal reports `Unable to establish loopback connection` with `UnixDomainSockets.connect0` before Gradle starts, Java may be using a redirected or unsuitable temporary socket path. Set a short, real temporary directory for this terminal only, then retry:

```powershell
$taskSocketDirectory = Join-Path (Get-Location) 'android\.gradle\java-tmp'
New-Item -ItemType Directory -Force -Path $taskSocketDirectory | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$taskSocketDirectory"
```

The path must be absolute and short (Unix-domain socket paths have a small length limit). A path without spaces is easiest. This setting does not change network permissions. See [Java's socket temporary-directory configuration](https://docs.oracle.com/en/java/javase/21/core/java-networking.html).

## Edge-to-edge implementation

`capacitor.config.json` enables the Capacitor 8 core `SystemBars` plugin's CSS insets handling and declares `viewport-fit: cover` as its initial hint. `MainActivity.java` enables AndroidX edge-to-edge behavior, clears system-bar scrims on supported Android versions, and retains the native insets handling supplied by Capacitor. The native themes configure the launch background and transparent system bars; verify the handoff to the web view in both themes on a real phone.

The HTML viewport includes `viewport-fit=cover`; the page fills `100dvh`. Controls use safe-area padding while the decorative background extends behind the system bars. The app sets system-bar icon contrast when the theme changes. On older WebView versions, Capacitor provides fallback inset handling; keep Android System WebView up to date.

The brief's `StatusBar.setOverlaysWebView({ overlay: true })` call remains useful on older Android releases. On Android 16 / API 36, edge-to-edge is enforced and that option no longer changes the layout. Do not add the obsolete `adjustMarginsForEdgeToEdge` option or opt-out flags to this Capacitor 8 project.

References: [Capacitor System Bars](https://capacitorjs.com/docs/apis/system-bars), [Status Bar behavior](https://capacitorjs.com/docs/apis/status-bar), and [Android edge-to-edge](https://developer.android.com/develop/ui/views/layout/edge-to-edge).

## Permissions

| Permission | When and why it is used |
| --- | --- |
| Nearby devices / Bluetooth Scan and Connect | Discover and control the user's WingsOnHair accessory on Android 12+. Scanning is declared `neverForLocation`. |
| Fine/coarse location, Android 11 and earlier only | Android requires this permission for BLE scanning on those releases. No location is collected or transmitted. Location Services may also have to be enabled by the user. |
| Internet | Fetch the public GitHub release, commit, and documentation endpoints when requested. |
| Vibrate | Native haptic feedback. |

BLE hardware is optional so the explicitly labelled Preview remains usable without an accessory. Denying Bluetooth permission must leave Preview and the rest of the interface usable. The unused microphone/audio permissions and microphone hardware declaration have been removed. The simplified app does not request microphone or motion-sensor access and does not expose Beat Sync or Shake to Flutter. No background service, advertising permission, or package-install permission is requested.

## Back, lifecycle, and Bluetooth

Android Back first closes the open connection, speed, mode-preview, or About sheet. From the optional name step it returns to the welcome. From the home screen it minimizes the app. When hidden, the app requests a stop and pauses its visual animation; returning to the foreground does not automatically restart physical motion. A disconnect also causes the firmware to park and detach PWM once the Bluetooth stack detects the lost connection. Turning Bluetooth off must not leave the interface showing a live connection.

Holding a mode opens a local animated preview over a blurred background. The currently running accessory continues its existing mode until an explicit **Use mode** action is taken; opening or dismissing the preview must not send a different mode command. These sheets replace the former tabs, Custom Studio, name-entry flow, and telemetry dashboard. Advanced firmware parameters remain supported by the unchanged protocol but have no controls in the simplified UI.

## Device acceptance checks

1. Use the one-page welcome both ways: **Let’s begin** opens connection setup, and **Try preview** enters a clearly labelled local simulation. Restart and confirm welcome completion, theme, mode, and speed preferences persist. Replaying the welcome should not request a name.
2. Test gesture navigation and three-button navigation in light and dark mode, including a display cutout and landscape. The floating title bar, butterfly, four mode buttons, and Start/Pause must remain reachable without horizontal overflow.
3. With Bluetooth off, open Connect. Accept and decline Android’s enable prompt in separate runs; both paths must remain responsive. Test permission denial, scanning cancellation, no accessory in range, and reconnecting after a failure.
4. With the linkage safely mounted, connect to `WingsOnHair` and exercise Calm, Pulse, Energy, and Night. Confirm the SVG follows reported servo commands. Use Pause and verify physical parking followed by PWM detach; use Start to resume.
5. Hold a mode while another mode is active. Check the local preview, the blurred background, and native haptic feedback. Dismissing it must preserve the existing mode. Choosing **Use mode** must apply the previewed mode. Test short taps, long holds, pointer cancellation, and dragging/scrolling without accidental selection.
6. Adjust speed in its sheet, close it, and reopen it to verify the value. Exercise the supported range only after calibrating safe mechanical travel. Tap the butterfly for one quick flutter and verify the prior mode returns, including returning to rest when previously paused.
7. Press Back from the connection, speed, mode-preview, and About sheets. Confirm a cancelled scan cannot reopen a closed sheet. From home, minimize and restore the app; verify it requests a stop in the background and returns paused.
8. Turn Bluetooth off during motion, reconnect, and disconnect deliberately. Confirm the firmware parks and the connection status changes. Test backgrounding and phone locking while connected.
9. Open About from the app mark. Test update checks online, offline, with no release, and under rate limiting. A commit alone is not an app version. Confirm release and project-guide links open correctly.
10. Confirm there are no tabs, name form, Custom Studio, main-screen telemetry grid, microphone prompt, or sensor toggles. Battery and servo feedback must retain the hardware limitations documented in the firmware guide.

## Updates

The small About sheet compares public GitHub releases with version 2.6 and links to the project/hardware guide. The app checks on open or resume (at most once per 30 minutes in a session) and shows an in-app alert for a newer release. If that release includes an APK asset, the alert links directly to its download; otherwise it opens the release page. Dismissing one version does not hide later versions. Release links open externally; the app does not silently install APKs. Firmware is flashed over USB. A secure BLE firmware update protocol, signed image verification, rollback partitions, and app-store update distribution are separate release-engineering work; they are not implied by a GitHub API check.
