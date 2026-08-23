/** SHIBASS S1 — Web Audio engine (EQ, spectrum, waveform, transport). */
(function (global) {
  "use strict";

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.source = null;
      this.gainNode = null;
      this.panNode = null;
      this.bass = null;
      this.mid = null;
      this.treble = null;
      this.analyser = null;
      this.buffer = null;
      this.startAt = 0;
      this.pausedAt = 0;
      this.playing = false;
      this.loop = false;
      this.rate = 1;
      this.onEnded = null;
      this._raf = 0;
      this._drawWave = null;
      this._drawSpec = null;
    }

    async ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.gainNode = this.ctx.createGain();
        this.panNode = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        this.bass = this.ctx.createBiquadFilter();
        this.mid = this.ctx.createBiquadFilter();
        this.treble = this.ctx.createBiquadFilter();
        this.analyser = this.ctx.createAnalyser();

        this.bass.type = "lowshelf";
        this.bass.frequency.value = 120;
        this.mid.type = "peaking";
        this.mid.frequency.value = 1000;
        this.mid.Q.value = 0.7;
        this.treble.type = "highshelf";
        this.treble.frequency.value = 3200;
        this.analyser.fftSize = 2048;

        let chain = this.gainNode;
        if (this.panNode) {
          this.gainNode.connect(this.panNode);
          chain = this.panNode;
        }
        chain.connect(this.bass);
        this.bass.connect(this.mid);
        this.mid.connect(this.treble);
        this.treble.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return this.ctx;
    }

    setGain(v) {
      if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(2, v));
    }
    setBalance(v) {
      // v: -1..1
      if (this.panNode) this.panNode.pan.value = Math.max(-1, Math.min(1, v));
    }
    setEq(band, db) {
      const node = this[band];
      if (node) node.gain.value = Math.max(-24, Math.min(24, db));
    }
    setVolume(v) {
      this.setGain(v);
    }

    async loadUrl(url) {
      await this.ensure();
      this.stop(true);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load media: " + res.status);
      const arr = await res.arrayBuffer();
      this.buffer = await this.ctx.decodeAudioData(arr.slice(0));
      this.pausedAt = 0;
      return this.buffer;
    }

    play() {
      if (!this.buffer) return;
      this.ensure();
      this.stop(true);
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = this.loop;
      src.playbackRate.value = this.rate;
      src.connect(this.gainNode);
      src.onended = () => {
        if (!this.playing) return;
        this.playing = false;
        if (this.onEnded) this.onEnded();
      };
      const offset = Math.min(this.pausedAt, this.buffer.duration - 0.01);
      src.start(0, Math.max(0, offset));
      this.source = src;
      this.startAt = this.ctx.currentTime - offset;
      this.playing = true;
      this._startViz();
    }

    pause() {
      if (!this.playing) return;
      this.pausedAt = this.currentTime();
      this.playing = false;
      if (this.source) {
        try { this.source.onended = null; this.source.stop(); } catch (_) {}
        this.source = null;
      }
    }

    stop(keepOffset) {
      this.playing = false;
      if (this.source) {
        try { this.source.onended = null; this.source.stop(); } catch (_) {}
        this.source = null;
      }
      if (!keepOffset) this.pausedAt = 0;
      this._stopViz();
    }

    seek(sec) {
      this.pausedAt = Math.max(0, Math.min(sec, this.duration()));
      if (this.playing) this.play();
    }

    currentTime() {
      if (this.playing && this.ctx) {
        return Math.min(
          (this.ctx.currentTime - this.startAt) * this.rate,
          this.duration()
        );
      }
      return this.pausedAt;
    }

    duration() {
      return this.buffer ? this.buffer.duration : 0;
    }

    setLoop(on) {
      this.loop = !!on;
      if (this.source) this.source.loop = this.loop;
    }

    setRate(r) {
      this.rate = Math.max(0.5, Math.min(2, r));
      if (this.source) this.source.playbackRate.value = this.rate;
    }

    attachViz(drawWave, drawSpec) {
      this._drawWave = drawWave;
      this._drawSpec = drawSpec;
    }

    _startViz() {
      const tick = () => {
        if (!this.analyser) return;
        const wf = new Uint8Array(this.analyser.fftSize);
        const sp = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteTimeDomainData(wf);
        this.analyser.getByteFrequencyData(sp);
        if (this._drawWave) this._drawWave(wf);
        if (this._drawSpec) this._drawSpec(sp);
        if (this.playing) this._raf = requestAnimationFrame(tick);
      };
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(tick);
    }

    _stopViz() {
      cancelAnimationFrame(this._raf);
    }

    /** Simple MIDI → note on piano + beep (no soundfont). */
    async playMidiNotes(notes) {
      await this.ensure();
      const now = this.ctx.currentTime;
      notes.forEach((n) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
        g.gain.setValueAtTime(0.0001, now + n.start);
        g.gain.exponentialRampToValueAtTime(0.12, now + n.start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.start + Math.max(0.08, n.dur));
        osc.connect(g);
        g.connect(this.gainNode);
        osc.start(now + n.start);
        osc.stop(now + n.start + Math.max(0.1, n.dur) + 0.05);
      });
    }
  }

  global.ShibassAudio = AudioEngine;
})(window);
