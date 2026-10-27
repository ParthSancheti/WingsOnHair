import { Motion } from '@capacitor/motion';

/** Foreground-only motion and microphone processing. Audio never leaves the device. */
export class WingSensors extends EventTarget {
  constructor() {
    super();
    this.state = { shakeEnabled: false, beatEnabled: false, level: 0, error: null };
    this._shakeGeneration = 0;
    this._beatGeneration = 0;
    this._visibility = () => {
      if (document.hidden) {
        void this.stopShake();
        void this.stopBeat();
      }
    };
    globalThis.document?.addEventListener('visibilitychange', this._visibility);
  }

  _update(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent('state', { detail: this.state }));
  }

  async startShake(onFlutter) {
    await this.stopShake();
    const generation = ++this._shakeGeneration;
    try {
      if (!globalThis.DeviceMotionEvent) throw new Error('Motion sensing is not available on this device.');
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const permission = await DeviceMotionEvent.requestPermission();
        if (permission !== 'granted') throw new Error('Allow motion access to use Shake to Flutter.');
      }
      if (generation !== this._shakeGeneration) return false;
      let previous = null;
      let lastPeak = 0;
      let lastTrigger = 0;
      let samples = 0;
      const handle = await Motion.addListener('accel', event => {
        if (generation !== this._shakeGeneration) return;
        const raw = event.acceleration;
        const hasLinear = raw && [raw.x, raw.y, raw.z].every(value => typeof value === 'number' && Number.isFinite(value));
        const vector = hasLinear ? raw : event.accelerationIncludingGravity;
        if (!vector || ![vector.x, vector.y, vector.z].every(value => typeof value === 'number' && Number.isFinite(value))) return;
        samples++;
        const magnitude = hasLinear
          ? Math.hypot(vector.x, vector.y, vector.z)
          : previous ? Math.hypot(vector.x - previous.x, vector.y - previous.y, vector.z - previous.z) : 0;
        previous = { x: vector.x, y: vector.y, z: vector.z };
        const now = performance.now();
        if (magnitude > 13 && now - lastTrigger > 900) {
          if (lastPeak && now - lastPeak > 60 && now - lastPeak < 450) {
            lastTrigger = now;
            lastPeak = 0;
            Promise.resolve().then(onFlutter).catch(error => this._update({ error: error.message }));
          } else if (now - lastPeak > 450 || !lastPeak) lastPeak = now;
        }
      });
      if (generation !== this._shakeGeneration) {
        await handle.remove();
        return false;
      }
      this._shakeHandle = handle;
      this._update({ shakeEnabled: true, error: null });
      this._shakeTimeout = setTimeout(() => {
        if (generation === this._shakeGeneration && samples === 0) {
          void this.stopShake().then(() => this._update({ error: 'No motion sensor data received. Try on a phone with motion access enabled.' }));
        }
      }, 4000);
      return true;
    } catch (error) {
      if (generation === this._shakeGeneration) this._update({ shakeEnabled: false, error: error.message });
      throw error;
    }
  }

  async stopShake() {
    ++this._shakeGeneration;
    clearTimeout(this._shakeTimeout);
    const handle = this._shakeHandle;
    this._shakeHandle = null;
    if (handle) await handle.remove().catch(() => {});
    if (this.state.shakeEnabled) this._update({ shakeEnabled: false });
  }

  async startBeat(onBeat, onLevel = () => {}) {
    await this.stopBeat();
    const generation = ++this._beatGeneration;
    let stream;
    let context;
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!globalThis.navigator?.mediaDevices?.getUserMedia || !AudioContext) throw new Error('Microphone beat sync needs the Android app or a secure browser with microphone access.');
      // Created from the user's tap so mobile browsers can unlock the audio context.
      context = new AudioContext();
      await context.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (generation !== this._beatGeneration) {
        stream.getTracks().forEach(track => track.stop());
        await context.close();
        return false;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.45;
      source.connect(analyser);
      // Do not connect to destination: this must never play the microphone back.
      this._stream = stream;
      this._audioContext = context;
      this._audioSource = source;
      this._analyser = analyser;
      const spectrum = new Uint8Array(analyser.frequencyBinCount);
      const waveform = new Float32Array(analyser.fftSize);
      const firstBin = Math.max(1, Math.floor(45 / (context.sampleRate / analyser.fftSize)));
      const lastBin = Math.min(spectrum.length - 1, Math.ceil(260 / (context.sampleRate / analyser.fftSize)));
      let baseline = 0;
      let previousEnergy = 0;
      let lastBeat = -Infinity;
      let lastLevel = 0;
      const started = performance.now();
      const sample = (now) => {
        if (generation !== this._beatGeneration) return;
        analyser.getByteFrequencyData(spectrum);
        analyser.getFloatTimeDomainData(waveform);
        let energy = 0;
        let rms = 0;
        for (let i = firstBin; i <= lastBin; i++) energy += (spectrum[i] / 255) ** 2;
        energy /= lastBin - firstBin + 1;
        for (const value of waveform) rms += value * value;
        rms = Math.sqrt(rms / waveform.length);
        baseline = baseline * 0.97 + energy * 0.03;
        if (now - started > 650 && rms > 0.012 && energy > Math.max(0.06, baseline * 1.45) && energy - previousEnergy > 0.025 && now - lastBeat > 330) {
          lastBeat = now;
          Promise.resolve().then(onBeat).catch(error => this._update({ error: error.message }));
        }
        previousEnergy = energy;
        if (now - lastLevel > 80) {
          lastLevel = now;
          const level = Math.min(1, rms * 6);
          this.state = { ...this.state, level };
          onLevel(level);
        }
        this._audioFrame = requestAnimationFrame(sample);
      };
      this._update({ beatEnabled: true, error: null });
      this._audioFrame = requestAnimationFrame(sample);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (generation === this._beatGeneration) void this.stopBeat().then(() => this._update({ error: 'Microphone access ended. Tap Beat Sync to try again.' }));
      }, { once: true }));
      return true;
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') await context.close().catch(() => {});
      const message = /NotAllowed|Permission|denied/i.test(`${error.name} ${error.message}`)
        ? 'Allow microphone access to sync with nearby music. Audio is processed only on your device.'
        : error.message;
      if (generation === this._beatGeneration) this._update({ beatEnabled: false, level: 0, error: message });
      throw new Error(message, { cause: error });
    }
  }

  async stopBeat() {
    ++this._beatGeneration;
    if (this._audioFrame) cancelAnimationFrame(this._audioFrame);
    this._audioFrame = null;
    this._stream?.getTracks().forEach(track => track.stop());
    this._audioSource?.disconnect();
    this._analyser?.disconnect();
    const context = this._audioContext;
    this._stream = null;
    this._audioSource = null;
    this._analyser = null;
    this._audioContext = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
    if (this.state.beatEnabled || this.state.level) this._update({ beatEnabled: false, level: 0 });
  }

  async dispose() {
    globalThis.document?.removeEventListener('visibilitychange', this._visibility);
    await Promise.allSettled([this.stopShake(), this.stopBeat()]);
  }
}
