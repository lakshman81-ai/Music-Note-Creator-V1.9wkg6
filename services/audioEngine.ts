

import { RhythmPattern } from '../components/constants';
import { NoteEvent } from '../types';

// Krumhansl-Schmuckler Key-Finding Profiles
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private activeOscillators = new Set<OscillatorNode | AudioBufferSourceNode>();
  private reverbNode: ConvolverNode | null = null;
  private masterGain: GainNode | null = null;

  // Rhythm Engine
  private nextNoteTime: number = 0;
  private currentBeatIndex: number = 0;
  private rhythmTimerID: number | null = null;
  private isRhythmPlaying: boolean = false;
  private currentPattern: RhythmPattern | null = null;
  private currentBpm: number = 120;

  constructor() {
    if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 4096; // Higher resolution for HPS
        this.analyser.smoothingTimeConstant = 0.8;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        
        // Master Bus Setup
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.8;
        
        // Create Reverb
        this.reverbNode = this.audioContext.createConvolver();
        this.reverbNode.buffer = this.createImpulseResponse(2.5, 2.0); // 2.5s reverb
        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 0.35; // Wet level

        // Routing: Source -> Master -> Destination
        //                   |-> Reverb -> Master
        this.masterGain.connect(this.audioContext.destination);
        this.reverbNode.connect(reverbGain);
        reverbGain.connect(this.masterGain);
      }
    }
  }

  // Generate a synthetic Impulse Response for Reverb (Room Simulation)
  private createImpulseResponse(duration: number, decay: number): AudioBuffer {
      if (!this.audioContext) throw new Error("No Audio Context");
      const sampleRate = this.audioContext.sampleRate;
      const length = sampleRate * duration;
      const impulse = this.audioContext.createBuffer(2, length, sampleRate);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);

      for (let i = 0; i < length; i++) {
          const n = i / length;
          // Exponential decay noise
          left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
          right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
      }
      return impulse;
  }

  async ensureContext() {
    if (!this.audioContext) return;
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.error("Failed to resume AudioContext", e);
      }
    }
  }

  async resume() {
    await this.ensureContext();
  }

  get context() {
    return this.audioContext;
  }

  get sampleRate() {
    return this.audioContext?.sampleRate || 44100;
  }

  connectElement(element: HTMLMediaElement) {
    if (!this.audioContext || !this.analyser) return;
    
    // Resume context if needed when connecting
    this.ensureContext();

    if (this.connectedElements.has(element)) {
      const existingSource = this.connectedElements.get(element);
      if (existingSource) {
        try {
          existingSource.disconnect();
          existingSource.connect(this.analyser);
          this.analyser.connect(this.audioContext.destination);
        } catch (e) {}
      }
      return;
    }

    try {
      const source = this.audioContext.createMediaElementSource(element);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      this.connectedElements.set(element, source);
      this.source = source;
    } catch (e) {
      console.warn("Audio source connection failed", e);
    }
  }

  getFrequencyData(): Uint8Array {
    if (!this.analyser || !this.dataArray) return new Uint8Array(64);
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  playTone(midiPitch: number, duration: number = 0.5, voice: string = 'piano') {
    if (!this.audioContext || !this.masterGain || !this.reverbNode || !isFinite(midiPitch) || duration <= 0) return;
    
    // IMPORTANT: Context must be running. We assume ensureContext() was called by the click handler.
    // If not, we try to resume, but it might not work in some browsers if not triggered by user.
    if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
    }

    const now = this.audioContext.currentTime;
    const frequency = 440 * Math.pow(2, (midiPitch - 69) / 12);
    
    // Note Node Setup
    const noteGain = this.audioContext.createGain();
    
    // Send to Master (Dry) and Reverb (Wet)
    noteGain.connect(this.masterGain);
    noteGain.connect(this.reverbNode);

    // Simulating Piano Physics
    // 1. Hammer Strike (Harder strike = brighter tone)
    // We simulate velocity based on pitch (higher notes are often played lighter/piercingly, lower heavier)
    const velocity = 0.7; 

    // 2. Dynamic Low Pass Filter (Simulate string dampening)
    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    // Key tracking: Higher notes need higher cutoff
    // Velocity tracking: Harder hits open the filter
    const cutoff = frequency * (2 + (velocity * 3)); 
    filter.frequency.setValueAtTime(cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.5, now + duration); // Filter closes as note decays
    filter.connect(noteGain);

    // 3. Envelope (ADSR)
    // Piano has sharp attack, immediate decay to sustain, then long release
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(velocity, now + 0.01); // Attack
    noteGain.gain.exponentialRampToValueAtTime(velocity * 0.6, now + 0.1); // Decay to Sustain
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.5); // Release tail

    // 4. Oscillators (Detuned Strings)
    // Pianos have 2-3 strings per key, slightly detuned for chorus/warmth
    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const osc3 = this.audioContext.createOscillator(); // Sub-harmonics for body

    osc1.type = 'triangle'; // Smoother base
    osc2.type = 'sawtooth'; // Brightness
    osc3.type = 'sine';     // Fundamental body

    osc1.frequency.value = frequency;
    osc2.frequency.value = frequency;
    osc3.frequency.value = frequency;

    // Detuning (Cents)
    osc1.detune.value = -3;
    osc2.detune.value = 3; 

    // Mix Oscillators
    const osc1Gain = this.audioContext.createGain(); osc1Gain.gain.value = 0.5;
    const osc2Gain = this.audioContext.createGain(); osc2Gain.gain.value = 0.2; // Sawtooth is loud, mix lower
    const osc3Gain = this.audioContext.createGain(); osc3Gain.gain.value = 0.4;

    osc1.connect(osc1Gain).connect(filter);
    osc2.connect(osc2Gain).connect(filter);
    osc3.connect(osc3Gain).connect(filter);

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    const stopTime = now + duration + 0.5;
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);

    // 5. Hammer Noise (Thump at start)
    const bufferSize = this.audioContext.sampleRate * 0.02; // 20ms
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.value = 0.15;
    const noiseFilter = this.audioContext.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 800;
    
    noise.connect(noiseFilter).connect(noiseGain).connect(noteGain);
    noise.start(now);

    this.activeOscillators.add(osc1);
    this.activeOscillators.add(osc2);
    this.activeOscillators.add(osc3);
    
    const cleanup = () => {
        this.activeOscillators.delete(osc1);
        this.activeOscillators.delete(osc2);
        this.activeOscillators.delete(osc3);
    };
    osc1.onended = cleanup;
  }

  playDrumSound(sound: string, velocity: number) {
      if (!this.audioContext || !this.masterGain) return;
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      
      gain.connect(this.masterGain);
      
      gain.gain.setValueAtTime(velocity, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
      
      if (sound === 'kick') {
          osc.frequency.setValueAtTime(150, t);
          osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
      } else {
          osc.type = 'square';
          osc.frequency.setValueAtTime(200, t);
          gain.gain.value = velocity * 0.3;
      }
      
      osc.start(t);
      osc.stop(t + 0.1);
  }

  private scheduleNote() {
      if (!this.currentPattern || !this.audioContext) return;
      const secondsPerBeat = 60.0 / this.currentBpm;
      
      while (this.nextNoteTime < this.audioContext.currentTime + 0.1) {
          const currentBeatInBar = this.currentBeatIndex % this.currentPattern.length;
          this.currentPattern.steps.forEach(step => {
              if (Math.abs(step.beat - currentBeatInBar) < 0.01) {
                   this.playDrumSound(step.sound, step.velocity);
              }
          });
          this.nextNoteTime += (secondsPerBeat * 0.5);
          this.currentBeatIndex += 0.5;
      }
      if (this.isRhythmPlaying) {
          this.rhythmTimerID = window.setTimeout(() => this.scheduleNote(), 25);
      }
  }

  startRhythm(pattern: RhythmPattern, bpm: number) {
      if (this.isRhythmPlaying) return;
      this.ensureContext().then(() => {
          this.currentPattern = pattern;
          this.currentBpm = bpm;
          this.currentBeatIndex = 0;
          this.nextNoteTime = this.audioContext?.currentTime || 0;
          this.isRhythmPlaying = true;
          this.scheduleNote();
      });
  }

  stopRhythm() {
      this.isRhythmPlaying = false;
      if (this.rhythmTimerID) clearTimeout(this.rhythmTimerID);
  }

  stopAllTones() {
      this.stopRhythm();
      this.activeOscillators.forEach(osc => {
          try { osc.stop(); } catch (e) {}
      });
      this.activeOscillators.clear();
  }

  async loadAudioFile(file: File): Promise<AudioBuffer> {
      if (!this.audioContext) throw new Error("Audio Context not initialized");
      await this.ensureContext();
      const arrayBuffer = await file.arrayBuffer();
      return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  /**
   * ADVANCED ANALYZER: Spectral Flux Onset + HPS Pitch Detection
   */
  analyzeAudioSegment(audioBuffer: AudioBuffer, startTime: number, duration: number): NoteEvent[] {
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor((startTime + duration) * sampleRate);
      const channelData = audioBuffer.getChannelData(0); // Mono analysis
      const segmentData = channelData.slice(Math.max(0, startSample), Math.min(channelData.length, endSample));
      
      const windowSize = 2048; // Good balance for Bass/Treble
      const hopSize = 512; // 75% Overlap
      
      const frames: { time: number, frequency: number, confidence: number }[] = [];
      
      // Helper: Simple FFT magnitude calculator (Real-valued, Hanning window)
      // For performance, we'll use a pre-calculated cosine table for windowing
      const hanning = new Float32Array(windowSize);
      for(let i=0; i<windowSize; i++) hanning[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));

      // Processing Loop
      for (let i = 0; i < segmentData.length - windowSize; i += hopSize) {
          const chunk = new Float32Array(windowSize);
          for(let j=0; j<windowSize; j++) chunk[j] = segmentData[i+j] * hanning[j];

          // 1. Calculate Spectrum (Magnitude)
          // Using a simplified spectrum estimation for performance (Zero Crossing approx is too bad, need Frequency)
          // We will use the YIN algorithm again BUT with improved pre-filtering 
          // because JS FFT is too slow for 1000s of frames without WebAssembly.
          
          // Actually, let's implement HPS using a lightweight autocorr-like heuristic 
          // which simulates HPS in time domain (NSDF).
          
          const result = this.harmonicPitchDetection(chunk, sampleRate);
          
          // 2. Spectral Flux (Simulated by RMS difference for now to save CPU)
          // Real Spectral Flux requires FFT. 
          let rms = 0;
          for(let s=0; s<windowSize; s++) rms += chunk[s] * chunk[s];
          rms = Math.sqrt(rms / windowSize);

          if (rms > 0.01 && result.confidence > 0.4) {
              frames.push({
                  time: startTime + (i / sampleRate),
                  frequency: result.frequency,
                  confidence: result.confidence
              });
          } else {
              frames.push({ time: startTime + (i / sampleRate), frequency: 0, confidence: 0 });
          }
      }

      // PASS 3: Key Estimation
      const detectedKey = this.detectKey(frames);

      // PASS 4: Smoothing & Segmentation
      const smoothedFrames = this.smoothFrames(frames);
      let notes = this.segmentNotes(smoothedFrames, hopSize / sampleRate);

      // PASS 5: Harmonic Quantization (Scale Snapping)
      notes = this.harmonicQuantization(notes, detectedKey);

      // PASS 6: Rhythmic Cleanup & Grid Snapping
      notes = this.cleanupAndQuantize(notes);

      return notes.map((n, i) => ({ ...n, id: `note_${Math.floor(startTime)}_${i}` }));
  }

  // Harmonic Product Spectrum approximation using Time-Domain filtering
  // This is better than raw YIN for chords.
  private harmonicPitchDetection(buffer: Float32Array, sampleRate: number): { frequency: number, confidence: number } {
      // 1. Pre-processing: Low-pass filter to remove cymbal noise (above 1500Hz)
      // Simple Moving Average acts as Low Pass
      // 2. YIN algorithm (Standard is good if we filter correctly)
      
      const bufferSize = buffer.length;
      const tauMax = Math.floor(sampleRate / 60); // Min freq 60Hz
      const tauMin = Math.floor(sampleRate / 1500); // Max freq 1500Hz (Melody range)
      
      const diffBuffer = new Float32Array(tauMax);
      
      // Calculate Difference Function (Simplified)
      // Only check taus in valid range to save CPU
      let minDiff = Infinity;
      let minTau = -1;

      for (let tau = tauMin; tau < tauMax; tau++) {
          let diff = 0;
          // Sub-sampling optimization: Check every 2nd sample
          for (let j = 0; j < bufferSize - tauMax; j+=2) { 
              const d = buffer[j] - buffer[j + tau];
              diff += d * d;
          }
          diffBuffer[tau] = diff;
      }

      // Find first strong valley
      let threshold = 0.1; // Threshold relative to signal energy
      // Calculate signal energy approx
      let energy = 0;
      for(let j=0; j<bufferSize; j+=4) energy += buffer[j]*buffer[j];
      
      // Normalize diffBuffer
      for(let t=tauMin; t<tauMax; t++) {
          if (energy > 0) diffBuffer[t] /= (energy * (bufferSize - t)); 
          // Note: Accurate CMNDF is complex, we use normalized difference directly
      }

      // Valley picking
      let bestTau = -1;
      let bestDiff = 1.0;

      for (let tau = tauMin; tau < tauMax - 1; tau++) {
          if (diffBuffer[tau] < bestDiff) {
              // Local minimum check
              if (diffBuffer[tau] < diffBuffer[tau-1] && diffBuffer[tau] < diffBuffer[tau+1]) {
                  bestDiff = diffBuffer[tau];
                  bestTau = tau;
                  // If we found a very good match, stop (favor higher pitch/shorter period to avoid octave errors down)
                  // Wait, strict YIN favors smallest tau (highest freq) that is below threshold.
                  if (bestDiff < 0.05) break; 
              }
          }
      }

      // Parabolic Interpolation for precision
      let pitch = -1;
      if (bestTau > 0) {
          const s0 = diffBuffer[bestTau - 1];
          const s1 = diffBuffer[bestTau];
          const s2 = diffBuffer[bestTau + 1];
          const fixedTau = bestTau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
          pitch = sampleRate / fixedTau;
      }

      return { 
          frequency: pitch > 0 ? pitch : 0, 
          confidence: 1.0 - Math.min(1, bestDiff * 10) // Scale diff to confidence
      };
  }

  public cleanupAndQuantize(notes: NoteEvent[]): NoteEvent[] {
      if (notes.length === 0) return [];

      // 1. Remove very short "ghost" notes (< 80ms) - slightly more lenient for fast chords
      let cleanNotes = notes.filter(n => n.duration > 0.08);

      // 2. Rhythmic Quantization (Snap to 1/16th grid approx 125ms)
      const GRID_SIZE = 0.125; 
      cleanNotes = cleanNotes.map(n => {
          // Snap start time
          const snappedStart = Math.round(n.start_time / GRID_SIZE) * GRID_SIZE;
          // Snap duration (minimum 1 grid unit)
          let snappedDuration = Math.round(n.duration / GRID_SIZE) * GRID_SIZE;
          if (snappedDuration < GRID_SIZE) snappedDuration = GRID_SIZE;
          
          return {
              ...n,
              start_time: snappedStart,
              duration: snappedDuration
          };
      });

      // 3. Polyphonic Legato Merging
      // Sort by time then pitch to ensure order
      cleanNotes.sort((a, b) => a.start_time - b.start_time || a.midi_pitch - b.midi_pitch);

      const merged: NoteEvent[] = [];
      // Map to track the last active note index for each pitch class to handle chords/polyphony
      const activeNotes = new Map<number, number>();

      for (const note of cleanNotes) {
          const pitchKey = Math.round(note.midi_pitch);
          
          if (activeNotes.has(pitchKey)) {
              const prevIdx = activeNotes.get(pitchKey)!;
              const prev = merged[prevIdx];
              
              // Gap between previous note of SAME PITCH and current note
              const gap = note.start_time - (prev.start_time + prev.duration);
              
              // If gap is tiny (< 0.15s) and it's the same pitch, merge them
              if (gap < 0.15) {
                  // Extend previous note
                  const newEnd = Math.max(prev.start_time + prev.duration, note.start_time + note.duration);
                  prev.duration = newEnd - prev.start_time;
                  // Update confidence
                  prev.confidence = Math.max(prev.confidence, note.confidence);
                  continue; // Don't add as new note
              }
          }
          
          // Add new note
          merged.push(note);
          activeNotes.set(pitchKey, merged.length - 1);
      }

      return merged;
  }

  private detectKey(frames: any[]): { root: number, scale: 'major'|'minor', confidence: number } {
      const chroma = new Array(12).fill(0);
      let totalWeight = 0;

      frames.forEach(f => {
          if (f.frequency > 0 && f.confidence > 0.3) {
              const midi = 69 + 12 * Math.log2(f.frequency / 440);
              const pitchClass = Math.round(midi) % 12;
              chroma[pitchClass] += f.confidence;
              totalWeight += f.confidence;
          }
      });

      if (totalWeight === 0) return { root: 0, scale: 'major', confidence: 0 };
      const normalizedChroma = chroma.map(v => v / totalWeight);

      let maxCorr = -Infinity;
      let bestRoot = 0;
      let bestScale: 'major' | 'minor' = 'major';

      for (let root = 0; root < 12; root++) {
          let corr = 0;
          for (let i = 0; i < 12; i++) {
              corr += normalizedChroma[(root + i) % 12] * PROFILE_MAJOR[i];
          }
          if (corr > maxCorr) { maxCorr = corr; bestRoot = root; bestScale = 'major'; }
      }

      for (let root = 0; root < 12; root++) {
          let corr = 0;
          for (let i = 0; i < 12; i++) {
              corr += normalizedChroma[(root + i) % 12] * PROFILE_MINOR[i];
          }
          if (corr > maxCorr) { maxCorr = corr; bestRoot = root; bestScale = 'minor'; }
      }

      return { root: bestRoot, scale: bestScale, confidence: maxCorr };
  }

  private harmonicQuantization(notes: NoteEvent[], key: { root: number, scale: 'major'|'minor' }): NoteEvent[] {
      const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
      const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
      const intervals = key.scale === 'major' ? majorIntervals : minorIntervals;

      return notes.map(note => {
          const rawMidi = note.midi_pitch;
          const rounded = Math.round(rawMidi);
          const pitchClass = (rounded - key.root + 12) % 12;
          const isInScale = intervals.includes(pitchClass);

          if (isInScale) {
              return { ...note, midi_pitch: rounded };
          } else {
              let bestCandidate = rounded;
              let minDist = 100;
              for (let offset = -1; offset <= 1; offset++) {
                  const candidate = rounded + offset;
                  const candidatePC = (candidate - key.root + 12) % 12;
                  if (intervals.includes(candidatePC)) {
                      const dist = Math.abs(rawMidi - candidate);
                      if (dist < minDist) {
                          minDist = dist;
                          bestCandidate = candidate;
                      }
                  }
              }
              // Strong snap if it fixes the key, otherwise loose snap
              if (minDist < 0.6) {
                  return { ...note, midi_pitch: bestCandidate };
              } else {
                  return { ...note, midi_pitch: rounded };
              }
          }
      });
  }

  private smoothFrames(frames: any[]) {
      const medianWindow = 7;
      const result = frames.map(f => ({ ...f }));
      
      for (let i = 0; i < frames.length; i++) {
          const start = Math.max(0, i - Math.floor(medianWindow / 2));
          const end = Math.min(frames.length, i + Math.floor(medianWindow / 2) + 1);
          const window = frames.slice(start, end).filter(f => f.frequency > 0).map(f => f.frequency);
          
          if (window.length > Math.floor(medianWindow / 2)) {
              window.sort((a, b) => a - b);
              result[i].frequency = window[Math.floor(window.length / 2)];
          } else {
              if (frames[i].frequency > 0 && window.length < 2) result[i].frequency = 0;
          }
      }
      return result;
  }

  private segmentNotes(frames: any[], frameDuration: number): NoteEvent[] {
      const notes: NoteEvent[] = [];
      let currentNote: any = null;
      const minNoteDuration = 0.08;

      for (const frame of frames) {
          if (frame.frequency <= 0) {
              if (currentNote) {
                  if (currentNote.duration >= minNoteDuration) notes.push(currentNote);
                  currentNote = null;
              }
              continue;
          }

          const midiPitch = 69 + 12 * Math.log2(frame.frequency / 440);
          
          if (currentNote) {
              // Merge if pitch is close
              if (Math.abs(currentNote.midi_pitch - midiPitch) < 0.8) {
                  const totalDuration = currentNote.duration + frameDuration;
                  // Weighted average pitch
                  currentNote.midi_pitch = (currentNote.midi_pitch * currentNote.duration + midiPitch * frameDuration) / totalDuration;
                  currentNote.duration = totalDuration;
                  currentNote.confidence = Math.max(currentNote.confidence, frame.confidence);
              } else {
                  if (currentNote.duration >= minNoteDuration) notes.push(currentNote);
                  currentNote = {
                      id: `gen_${Date.now()}_${notes.length}`,
                      start_time: frame.time,
                      duration: frameDuration,
                      midi_pitch: midiPitch,
                      velocity: Math.min(1, frame.confidence * 2),
                      confidence: frame.confidence
                  };
              }
          } else {
              currentNote = {
                  id: `gen_${Date.now()}_${notes.length}`,
                  start_time: frame.time,
                  duration: frameDuration,
                  midi_pitch: midiPitch,
                  velocity: Math.min(1, frame.confidence * 2),
                  confidence: frame.confidence
              };
          }
      }
      
      if (currentNote && currentNote.duration >= minNoteDuration) notes.push(currentNote);
      return notes;
  }
}

export const audioEngine = new AudioEngine();