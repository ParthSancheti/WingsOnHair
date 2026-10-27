import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { COMMAND_UUID, DEFAULT_SETTINGS, DEVICE_NAME, SERVICE_UUID, TELEMETRY_UUID, decodeTelemetry, encodeCommand, sampleWingAngle, validateSettings } from './protocol.js';

const errorMessage = (error) => {
  const message = error?.message || String(error);
  if (/cancel|notfounderror|no device selected/i.test(message)) return 'Connection cancelled. Your wings are ready when you are.';
  if (/permission|denied|notallowed/i.test(message)) return 'Bluetooth permission is needed. Allow Nearby devices in your phone settings, then try again.';
  if (/location.*disabled|location.*off/i.test(message)) return 'This Android version needs Location enabled to discover Bluetooth devices.';
  return message;
};

/** A real BLE transport and an explicitly separate, opt-in preview transport. */
export class WingConnection extends EventTarget {
  constructor({ client = BleClient, platform = Capacitor.getPlatform() } = {}) {
    super();
    this.client = client;
    this.platform = platform;
    this.state = { status: 'disconnected', deviceName: null, bluetoothEnabled: null, lastTelemetry: null, error: null, rssi: null, stability: 'offline', isDemo: false };
    this.settings = { ...DEFAULT_SETTINGS, mode: 0 };
    this._session = 0;
    this._initialized = false;
    this._initializing = null;
    this._deviceId = null;
    this._scanTask = null;
    this._pending = null;
    this._writing = false;
    this._lastWrite = 0;
    this._disposed = false;
  }

  _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  _setState(patch) {
    this.state = { ...this.state, ...patch };
    this._emit('state', this.state);
  }

  async initialize() {
    if (this._disposed) throw new Error('This connection has been disposed.');
    if (this._initialized) return this.state;
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      if (this.platform === 'web' && !globalThis.navigator?.bluetooth) {
        throw new Error('This browser cannot connect to Bluetooth. Use the Android app or a supported Chrome/Edge browser, or explore Preview mode.');
      }
      await this.client.initialize({ androidNeverForLocation: true });
      if (this._disposed) throw new Error('This connection has been disposed.');
      if (this.platform !== 'web') {
        const enabled = await this.client.isEnabled();
        this._setState({ bluetoothEnabled: enabled });
        await this.client.startEnabledNotifications((bluetoothEnabled) => {
          this._setState({ bluetoothEnabled });
          if (!bluetoothEnabled && this.state.status !== 'demo' && (this._deviceId || this._cancelScan)) {
            void this.disconnect({ reason: 'Bluetooth is off. Turn it on to reconnect your wings.' });
          }
        });
        if (this._disposed) {
          await this.client.stopEnabledNotifications().catch(() => {});
          throw new Error('This connection has been disposed.');
        }
      } else {
        // Web Bluetooth does not reliably expose the adapter power state.
        this._setState({ bluetoothEnabled: null });
      }
      this._initialized = true;
      return this.state;
    })();
    try { return await this._initializing; }
    catch (error) {
      this._setState({ error: errorMessage(error) });
      throw error;
    } finally { this._initializing = null; }
  }

  async _chooseNativeDevice(session) {
    let timeout;
    let resolveScan;
    let rejectScan;
    const discovered = new Promise((resolve, reject) => { resolveScan = resolve; rejectScan = reject; });
    // Register the rejection handler before starting the asynchronous scanner.
    const scanResult = discovered.then(value => ({ value }), error => ({ error }));
    this._cancelScan = () => rejectScan(new Error('Connection cancelled.'));
    timeout = setTimeout(() => rejectScan(new Error('No wings found. Power on your clip, keep it nearby, and try again.')), 12000);
    try {
      await this.client.requestLEScan({ services: [SERVICE_UUID], allowDuplicates: false, scanMode: 2 }, (result) => {
        if (session === this._session && result.device?.deviceId) {
          // The private service UUID identifies this firmware; names can be absent in advertisements.
          resolveScan(result.device);
        }
      });
      const result = await scanResult;
      if (result.error) throw result.error;
      return result.value;
    } finally {
      clearTimeout(timeout);
      this._cancelScan = null;
      await this.client.stopLEScan().catch(() => {});
    }
  }

  async connect() {
    if (this._disposed) throw new Error('This connection has been disposed.');
    if (['scanning', 'connecting'].includes(this.state.status)) return this.state;
    if (this.state.status === 'connected') return this.state;
    if (this.state.status === 'demo') {
      const closing = this.disconnect();
      const closingSession = this._session;
      await closing;
      if (closingSession !== this._session || this._disposed) return this.state;
    }
    const session = ++this._session;
    this._setState({ status: 'scanning', isDemo: false, error: null, lastTelemetry: null, rssi: null, stability: 'waiting' });
    let device;
    try {
      await this.initialize();
      if (session !== this._session) return this.state;
      if (this.platform !== 'web' && !(await this.client.isEnabled())) {
        this._setState({ bluetoothEnabled: false });
        if (this.platform === 'android') {
          await this.client.requestEnable();
          const enabled = await this.client.isEnabled();
          this._setState({ bluetoothEnabled: enabled });
          if (!enabled) throw new Error('Bluetooth is still off. Turn it on to find your wings.');
        } else throw new Error('Bluetooth is off. Turn it on in your phone settings to find your wings.');
      }
      if (session !== this._session) return this.state;
      if (this.platform === 'web') {
        device = await this.client.requestDevice({ services: [SERVICE_UUID], optionalServices: [SERVICE_UUID] });
      } else {
        // Native scanners are global. Finish an earlier cancelled scan before
        // starting another so its stopLEScan cannot stop the new attempt.
        if (this._scanTask) await this._scanTask.catch(() => {});
        if (session !== this._session) return this.state;
        const task = this._chooseNativeDevice(session);
        this._scanTask = task;
        try { device = await task; }
        finally { if (this._scanTask === task) this._scanTask = null; }
      }
      if (session !== this._session) return this.state;
      this._deviceId = device.deviceId;
      this._setState({ status: 'connecting', deviceName: device.name || DEVICE_NAME });
      await this.client.connect(device.deviceId, () => {
        if (this._deviceId === device.deviceId && session === this._session) {
          ++this._session;
          this._deviceId = null;
          this._clearTimers();
          this._rejectPending(new Error('Your wings disconnected.'));
          this._setState({ status: 'disconnected', deviceName: null, lastTelemetry: null, rssi: null, stability: 'offline', error: 'Your wings disconnected. Move closer and reconnect.' });
        }
      }, { timeout: 12000 });
      if (session !== this._session) {
        await this.client.disconnect(device.deviceId).catch(() => {});
        return this.state;
      }
      await this.client.startNotifications(device.deviceId, SERVICE_UUID, TELEMETRY_UUID, value => {
        if (session !== this._session) return;
        try { this._receiveTelemetry(decodeTelemetry(value)); }
        catch (error) { this._setState({ error: error.message, stability: 'delayed' }); }
      });
      if (session !== this._session) {
        await this.client.disconnect(device.deviceId).catch(() => {});
        return this.state;
      }
      this._setState({ status: 'connected', error: null, isDemo: false, stability: this.state.lastTelemetry ? 'live' : 'waiting' });
      this._startHealthCheck();
      if (this.platform !== 'web') this._startRssi(session, device.deviceId);
      return this.state;
    } catch (error) {
      if (session === this._session) {
        // Invalidate before cleanup so a native disconnect callback cannot replace
        // the original pairing error or make a failed connection look successful.
        ++this._session;
        this._deviceId = null;
        this._clearTimers();
        this._setState({ status: 'disconnected', deviceName: null, stability: 'offline', error: errorMessage(error) });
        if (device?.deviceId) await this.client.disconnect(device.deviceId).catch(() => {});
        throw new Error(errorMessage(error), { cause: error });
      }
      if (device?.deviceId) await this.client.disconnect(device.deviceId).catch(() => {});
      return this.state;
    }
  }

  _receiveTelemetry(telemetry) {
    this.state = { ...this.state, lastTelemetry: telemetry };
    const stability = this.state.isDemo ? 'preview' : 'live';
    if (this.state.stability !== stability) this._setState({ stability });
    this._emit('telemetry', telemetry);
  }

  _startHealthCheck() {
    clearInterval(this._healthTimer);
    const connectedAt = Date.now();
    this._healthTimer = setInterval(() => {
      if (this.state.status !== 'connected') return;
      const age = Date.now() - (this.state.lastTelemetry?.receivedAt ?? connectedAt);
      const stability = age > 1800 ? 'delayed' : this.state.lastTelemetry ? 'live' : 'waiting';
      if (stability !== this.state.stability) this._setState({ stability });
    }, 500);
  }

  _startRssi(session, deviceId) {
    let reading = false;
    const read = async () => {
      if (reading || session !== this._session) return;
      reading = true;
      try {
        const rssi = await this.client.readRssi(deviceId);
        if (session === this._session) this._setState({ rssi });
      } catch { /* Packet freshness remains available when RSSI cannot be read. */ }
      finally { reading = false; }
    };
    void read();
    this._rssiTimer = setInterval(read, 4000);
  }

  async startDemo() {
    if (this._disposed) throw new Error('This connection has been disposed.');
    const closing = this.disconnect();
    const closingSession = this._session;
    await closing;
    if (closingSession !== this._session || this._disposed) return this.state;
    const session = ++this._session;
    this.settings = { ...DEFAULT_SETTINGS };
    this._demoStart = Date.now();
    this._demoPhaseStart = this._demoStart;
    this._demoResume = null;
    this._demoSequence = 0;
    this._setState({ status: 'demo', isDemo: true, deviceName: 'Preview wings', error: null, rssi: null, stability: 'preview', lastTelemetry: null });
    const tick = () => {
      if (session !== this._session) return;
      const now = Date.now();
      if (this.settings.mode === 6 && now - this._demoPhaseStart >= 1000 / this.settings.speed) {
        this.settings = this._demoResume ?? { ...DEFAULT_SETTINGS, mode: 0 };
        this._demoResume = null;
        this._demoPhaseStart = now;
      }
      const angle = sampleWingAngle(this.settings, now - this._demoPhaseStart);
      this._receiveTelemetry({
        sequence: this._demoSequence++ % 256, mode: this.settings.mode, angle, targetAngle: angle,
        batteryPercent: null, batteryKind: 'unavailable', uptimeSeconds: Math.floor((now - this._demoStart) / 1000),
        running: this.settings.mode !== 0, servoAttached: this.settings.mode !== 0,
        speed: this.settings.speed, impulseX: this.settings.impulseX, impulseY: this.settings.impulseY, receivedAt: now,
      });
    };
    tick();
    this._demoTimer = setInterval(tick, 100);
    return this.state;
  }

  async send(settings) {
    const validated = validateSettings(settings);
    if (this.state.status === 'demo') {
      if (validated.mode === 6 && this.settings.mode !== 6) this._demoResume = { ...this.settings };
      if (validated.mode !== 6) this._demoResume = null;
      this.settings = validated;
      this._demoPhaseStart = Date.now();
      return validated;
    }
    if (this.state.status !== 'connected' || !this._deviceId) throw new Error('Connect your wings or enter Preview mode first.');
    return new Promise((resolve, reject) => {
      // Coalesce slider events, but settle every caller only after the newest command is written.
      const waiters = this._pending?.waiters ?? [];
      waiters.push({ resolve, reject });
      this._pending = { settings: validated, waiters, session: this._session, deviceId: this._deviceId };
      void this._drainWrites();
    });
  }

  async _drainWrites() {
    if (this._writing) return;
    this._writing = true;
    try {
      while (this._pending) {
        const remaining = 60 - (Date.now() - this._lastWrite);
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
        const item = this._pending;
        this._pending = null;
        if (!item) break;
        try {
          if (item.session !== this._session || this.state.status !== 'connected') throw new Error('Your wings disconnected before the command was sent.');
          await this.client.write(item.deviceId, SERVICE_UUID, COMMAND_UUID, encodeCommand(item.settings), { timeout: 3000 });
          if (item.session !== this._session) throw new Error('Your wings disconnected while sending the command.');
          this._lastWrite = Date.now();
          this.settings = item.settings;
          item.waiters.forEach(({ resolve }) => resolve(item.settings));
        } catch (error) {
          item.waiters.forEach(({ reject }) => reject(error));
          if (item.session === this._session) this._setState({ error: `Could not send the motion: ${errorMessage(error)}` });
        }
      }
    } finally { this._writing = false; }
  }

  _rejectPending(error) {
    this._pending?.waiters.forEach(({ reject }) => reject(error));
    this._pending = null;
  }

  _clearTimers() {
    clearInterval(this._demoTimer);
    clearInterval(this._healthTimer);
    clearInterval(this._rssiTimer);
  }

  async disconnect({ reason = null } = {}) {
    const deviceId = this._deviceId;
    const scanTask = this._scanTask;
    ++this._session;
    this._deviceId = null;
    this._cancelScan?.();
    this._clearTimers();
    this._rejectPending(new Error('Connection closed.'));
    this._setState({ status: 'disconnected', isDemo: false, deviceName: null, lastTelemetry: null, rssi: null, stability: 'offline', error: reason });
    if (scanTask) await scanTask.catch(() => {});
    if (deviceId) {
      // Disconnect also triggers the firmware's park-and-detach path.
      await this.client.stopNotifications(deviceId, SERVICE_UUID, TELEMETRY_UUID).catch(() => {});
      await this.client.disconnect(deviceId).catch(() => {});
    }
    return this.state;
  }

  async dispose() {
    this._disposed = true;
    await this.disconnect();
    if (this._initialized && this.platform !== 'web') await this.client.stopEnabledNotifications().catch(() => {});
    this._initialized = false;
  }
}
