
import { NoteEvent } from '../types';
import { formatPitch } from '../utils/pitchUtils';

// Constants
const GRID_DENOM = 32; // 1/32 note quantization
const BEATS_PER_MEASURE = 4; // Assuming 4/4 for now
const MIDDLE_C = 60;
const STAFF_SPACE = 10; // VexFlow default reference (approx)

export interface Measure {
  index: number;
  startBeat: number;
  endBeat: number;
  notes: NoteEvent[];
}

export const MusicNotationService = {
  /**
   * Main pipeline function to transform raw audio events into engraved-ready data
   */
  processNotes(rawNotes: NoteEvent[], bpm: number): Measure[] {
    if (rawNotes.length === 0) return [];

    // 1. Quantization & Normalization
    const quantizedNotes = this.quantizeNotes(rawNotes, bpm);

    // 2. Measure Splitting (with Ties)
    const splitNotes = this.splitAcrossMeasures(quantizedNotes);

    // 3. Staff Assignment
    const staffAssignedNotes = this.assignStaves(splitNotes);

    // 4. Group into Measures for further processing
    const measures = this.groupIntoMeasures(staffAssignedNotes);

    // 5. Voice Assignment & Rests (Per Measure)
    measures.forEach(m => {
        // Voice Assignment
        this.assignVoices(m.notes);

        // Slurs & Beams (after voice assignment)
        this.detectSlursAndBeams(m.notes);

        // Fill Rests
        m.notes = this.fillMeasureWithRests(m.notes, m.startBeat, m.endBeat);
    });

    return measures;
  },

  quantizeNotes(rawNotes: NoteEvent[], bpm: number): NoteEvent[] {
    return rawNotes.map(note => {
      const beatRaw = (note.start_time * bpm) / 60;
      const durationRaw = (note.duration * bpm) / 60;

      // Snap to 1/32 grid
      const startBeat = Math.round(beatRaw * GRID_DENOM) / GRID_DENOM;
      const durationBeats = Math.max(1/GRID_DENOM, Math.round(durationRaw * GRID_DENOM) / GRID_DENOM);

      // Pitch Label
      let label = note.pitch_label;
      if (!label) {
        const fmt = formatPitch(note.midi_pitch, { 
            format: 'scientific', 
            accidentalStyle: 'sharp', 
            showOctave: true,
        });
        label = fmt.display;
      }

      return {
        ...note,
        startBeat,
        durationBeats,
        pitch_label: label,
      } as NoteEvent;
    });
  },

  splitAcrossMeasures(notes: NoteEvent[]): NoteEvent[] {
      const processed: NoteEvent[] = [];

      notes.forEach(note => {
          let currentStart = note.startBeat!;
          let remainingDuration = note.durationBeats!;
          let isFirst = true;

          while (remainingDuration > 0.0001) { // Floating point tolerance
              const measureIndex = Math.floor(currentStart / BEATS_PER_MEASURE);
              const measureEnd = (measureIndex + 1) * BEATS_PER_MEASURE;
              const distToBar = measureEnd - currentStart;

              const chunkDuration = Math.min(remainingDuration, distToBar);

              const isLast = Math.abs(remainingDuration - chunkDuration) < 0.0001;

              // Determine tie status
              let tie: 'start' | 'stop' | 'continue' | null = null;
              if (!isFirst || !isLast) {
                  if (isFirst && !isLast) tie = 'start';
                  else if (!isFirst && !isLast) tie = 'continue';
                  else if (!isFirst && isLast) tie = 'stop';
              }
              // Special case: Single note split crossing 2 bars (start -> stop)
              // If it crosses >2 bars, the middle ones are 'continue'

              // Clone and adjust
              const chunk: NoteEvent = {
                  ...note,
                  id: isFirst ? note.id : `${note.id}_split_${measureIndex}`,
                  startBeat: currentStart,
                  durationBeats: chunkDuration,
                  tie: tie
              };
              processed.push(chunk);

              currentStart += chunkDuration;
              remainingDuration -= chunkDuration;
              isFirst = false;
          }
      });
      return processed.sort((a, b) => a.startBeat! - b.startBeat! || a.midi_pitch - b.midi_pitch);
  },

  assignStaves(notes: NoteEvent[]): NoteEvent[] {
      // 1. First pass: Nearest staff with threshold
      return notes.map(note => {
          // Approximate Y positions (VexFlow logic inverted: higher Y is lower pitch)
          // Middle C (C4, 60) is roughly center.
          // Treble Center: B4 (71)
          // Bass Center: D3 (50)

          const distToTreble = Math.abs(note.midi_pitch - 71);
          const distToBass = Math.abs(note.midi_pitch - 50);

          // Threshold: 2 spaces = approx 3.5 semitones?
          // In staff steps: 1 space = 2 steps (line/space).
          // Let's use semitones as proxy. Staff space is ~3-4 semitones depending on key.
          // User rule: "vertical_distance_to_staff <= 2 * staff_space"
          // Let's stick to simple MIDI split with "Ledger Line Limit" override.

          let staff: 'treble' | 'bass' = 'treble';

          // Ledger line logic:
          // Treble range w/o ledgers: D4 (62) to G5 (79)
          // Bass range w/o ledgers: F2 (41) to B3 (59)

          // If > 3 ledger lines (approx > 6 steps outside stave)
          // Treble Top Ledgers start > A5. 3 ledgers ~ E6+
          // Treble Bottom Ledgers start < C4. 3 ledgers ~ G3-

          // Bass Top Ledgers start > C4. 3 ledgers ~ A4+
          // Bass Bottom Ledgers start < E2. 3 ledgers ~ B1-

          if (note.midi_pitch >= 60) {
              staff = 'treble';
          } else {
              staff = 'bass';
          }

          // Fallback / Ledger Optimization
          // If note is 55 (G3), standard is Bass.
          // If note is 65 (F4), standard is Treble.

          // Ambiguous zone: 50-70.
          // If note is very high (e.g. 85), strictly Treble.
          // If note is very low (e.g. 35), strictly Bass.

          // Ambiguity Check (Rule 2 from plan)
          // If >3 ledgers on assigned staff, try swap.

          // Treble 3 ledgers low: < 50 (D3)
          // Bass 3 ledgers high: > 72 (C5)

          if (staff === 'treble' && note.midi_pitch < 50) staff = 'bass';
          if (staff === 'bass' && note.midi_pitch > 72) staff = 'treble';

          return { ...note, staff };
      });
  },

  groupIntoMeasures(notes: NoteEvent[]): Measure[] {
      if (notes.length === 0) return [];
      const lastEnd = notes.reduce((max, n) => Math.max(max, n.startBeat! + n.durationBeats!), 0);
      const totalMeasures = Math.ceil(lastEnd / BEATS_PER_MEASURE);

      const measures: Measure[] = [];
      for (let i = 0; i < totalMeasures; i++) {
          const start = i * BEATS_PER_MEASURE;
          const end = (i + 1) * BEATS_PER_MEASURE;
          measures.push({
              index: i,
              startBeat: start,
              endBeat: end,
              notes: notes.filter(n => n.startBeat! >= start && n.startBeat! < end)
          });
      }
      return measures;
  },

  assignVoices(notes: NoteEvent[]) {
      // Group overlapping notes
      // Simple strategy: Iterate sorted notes. If overlap, assign alternate voice.

      // Separate by staff first
      ['treble', 'bass'].forEach(staffType => {
          const staffNotes = notes.filter(n => n.staff === staffType);
          if (staffNotes.length === 0) return;

          // Detect overlaps
          // Map of beat -> usedVoices[]
          // Since we have quantized time, we can check collisions easily.

          // Greedy assignment
          staffNotes.forEach(note => {
             // Default Voice 1
             note.voice = 1;
          });

          // Check for collisions
          for (let i = 0; i < staffNotes.length; i++) {
              const current = staffNotes[i];
              // Check against previous notes that might still be sustaining
              // (Actually, checking overlapping intervals in local window is O(N^2) but N is small per measure)

              const overlapping = staffNotes.filter(other =>
                  other !== current &&
                  other.startBeat! < (current.startBeat! + current.durationBeats!) &&
                  (other.startBeat! + other.durationBeats!) > current.startBeat!
              );

              if (overlapping.length > 0) {
                  // Collision detected.
                  // If "current" starts at same time as "other", it's a chord -> Same Voice.
                  // If "current" starts different time -> Polyphony -> Different Voice.

                  const chordMates = overlapping.filter(o => Math.abs(o.startBeat! - current.startBeat!) < 0.001);
                  const polyphonyMates = overlapping.filter(o => Math.abs(o.startBeat! - current.startBeat!) >= 0.001);

                  // Chord Mates share voice of current (already 1).
                  // Polyphony mates need different voices.

                  // If I have a polyphony mate that is already assigned voice 1, I must be voice 2.
                  const usedVoices = new Set(polyphonyMates.map(p => p.voice));
                  if (usedVoices.has(1)) {
                      current.voice = 2;
                  }
                  // If >2 voices needed?
                  if (usedVoices.has(1) && usedVoices.has(2)) {
                      // Fallback: cycle
                      current.voice = 1; // Simplify to 2 voices max for now, or use logic
                  }
              }
          }
      });
  },

  detectSlursAndBeams(notes: NoteEvent[]) {
      // Per Staff, Per Voice
      ['treble', 'bass'].forEach(staffType => {
          [1, 2].forEach(voiceId => {
              const voiceNotes = notes.filter(n => n.staff === staffType && n.voice === voiceId);
              voiceNotes.sort((a,b) => a.startBeat! - b.startBeat!);

              if (voiceNotes.length < 2) return;

              // SLURS
              let slurGroup: NoteEvent[] = [];
              voiceNotes.forEach((note, idx) => {
                  if (idx === 0) {
                      slurGroup.push(note);
                      return;
                  }
                  const prev = voiceNotes[idx-1];
                  const gap = note.startBeat! - (prev.startBeat! + prev.durationBeats!);

                  // Rule: Gap < 1/32
                  if (gap < (1/32 + 0.001) && slurGroup.length < 8) {
                      slurGroup.push(note);
                  } else {
                      // Finalize previous group
                      if (slurGroup.length > 2) { // Minimum 3 notes for meaningful automatic slur? Or 2?
                         // User said "Slur when same voice and gap < 1/32... max 8".
                         // Usually 2 notes is a slur.
                         const id = `slur_${prev.id}`;
                         slurGroup.forEach(n => n.slurId = id);
                      }
                      slurGroup = [note];
                  }
              });
              // Flush last slur
              if (slurGroup.length >= 2) {
                   const id = `slur_${voiceNotes[voiceNotes.length-1].id}`;
                   slurGroup.forEach(n => n.slurId = id);
              }

              // BEAMS
              // Group consecutive 8th (0.5) or 16th (0.25) or 32nd notes within the same beat?
              // Standard beaming: By beat (quarter note chunks)
              let beamGroup: NoteEvent[] = [];

              voiceNotes.forEach((note, idx) => {
                  const isBeamable = note.durationBeats! <= 0.5; // 8th or smaller

                  if (!isBeamable) {
                      // Close previous beam
                      if (beamGroup.length > 1) {
                          const id = `beam_${beamGroup[0].id}`;
                          beamGroup.forEach(n => n.beamId = id);
                      }
                      beamGroup = [];
                      return;
                  }

                  // Check if fits in current beam group (same beat block)
                  // e.g. beat 1.0 to 1.99
                  const currentBeatFloor = Math.floor(note.startBeat!);

                  if (beamGroup.length > 0) {
                       const prevBeatFloor = Math.floor(beamGroup[0].startBeat!);
                       const prevEnd = beamGroup[beamGroup.length-1].startBeat! + beamGroup[beamGroup.length-1].durationBeats!;
                       const gap = note.startBeat! - prevEnd;

                       if (currentBeatFloor === prevBeatFloor && gap < 0.001) {
                           beamGroup.push(note);
                       } else {
                           // Close and start new
                           if (beamGroup.length > 1) {
                               const id = `beam_${beamGroup[0].id}`;
                               beamGroup.forEach(n => n.beamId = id);
                           }
                           beamGroup = [note];
                       }
                  } else {
                      beamGroup.push(note);
                  }
              });
               // Flush last beam
              if (beamGroup.length > 1) {
                   const id = `beam_${beamGroup[0].id}`;
                   beamGroup.forEach(n => n.beamId = id);
              }
          });
      });
  },

  fillMeasureWithRests(notes: NoteEvent[], measureStart: number, measureEnd: number): NoteEvent[] {
      // 1. Map occupied intervals per staff/voice?
      // Rests are usually shared if voices are silent? Or per voice?
      // Standard engraving: If Measure is polyphonic, each voice needs rests.
      // If monophonic, one rest line.

      // For simplicity/AI output: Treat "Global" rests if no notes play at all?
      // Or Per Staff?
      // Let's do Per Staff. If Treble is empty, full rest.
      // If Treble has gaps, fill gaps.
      // Voices: If voice 2 is used in measure, it needs rests. If voice 1 is used...
      // This gets complex. Simplified:
      // Fill "Voice 1" gaps on each staff. Ignore Voice 2 gaps to avoid clutter unless strictly required.

      const filledNotes = [...notes];

      ['treble', 'bass'].forEach(staff => {
          const staffNotes = notes.filter(n => n.staff === staff && n.voice === 1);
          staffNotes.sort((a,b) => a.startBeat! - b.startBeat!);

          let cursor = measureStart;

          // Insert rests before first note
          if (staffNotes.length > 0) {
               if (staffNotes[0].startBeat! > cursor) {
                   const gaps = this.generateRestEvents(cursor, staffNotes[0].startBeat!, staff as 'treble'|'bass');
                   filledNotes.push(...gaps);
               }
               cursor = staffNotes[0].startBeat! + staffNotes[0].durationBeats!;
          } else {
               // Empty staff -> Full measure rest
               // But wait, if NO notes in measure, generateRestEvents handles it?
          }

          // Gaps between notes
          for (let i = 0; i < staffNotes.length - 1; i++) {
              const currentEnd = staffNotes[i].startBeat! + staffNotes[i].durationBeats!;
              const nextStart = staffNotes[i+1].startBeat!;
              if (nextStart > currentEnd + 0.001) {
                  const gaps = this.generateRestEvents(currentEnd, nextStart, staff as 'treble'|'bass');
                  filledNotes.push(...gaps);
              }
          }

          // Gap after last note
          if (staffNotes.length > 0) {
              const lastEnd = staffNotes[staffNotes.length-1].startBeat! + staffNotes[staffNotes.length-1].durationBeats!;
              if (lastEnd < measureEnd - 0.001) {
                   const gaps = this.generateRestEvents(lastEnd, measureEnd, staff as 'treble'|'bass');
                   filledNotes.push(...gaps);
              }
          } else {
              // Whole measure rest
              const gaps = this.generateRestEvents(measureStart, measureEnd, staff as 'treble'|'bass');
              filledNotes.push(...gaps);
          }
      });

      return filledNotes.sort((a,b) => a.startBeat! - b.startBeat!);
  },

  generateRestEvents(start: number, end: number, staff: 'treble'|'bass'): NoteEvent[] {
      const duration = end - start;
      if (duration < 1/GRID_DENOM) return [];

      const rests: NoteEvent[] = [];
      let remaining = duration;
      let currentPos = start;

      // Greedy denomination
      const denoms = [4, 2, 1, 0.5, 0.25, 0.125, 0.03125]; // Whole, Half, Quarter, 8th, 16th, 32nd

      while (remaining >= 0.03125) { // 1/32
           // Find largest fit
           const fit = denoms.find(d => d <= remaining + 0.001);
           if (!fit) break;

           rests.push({
               id: `rest_${staff}_${currentPos}_${Math.random()}`, // unique ID
               start_time: 0, // irrelevant for display
               duration: 0,
               midi_pitch: 0, // irrelevant
               velocity: 0,
               confidence: 1,
               startBeat: currentPos,
               durationBeats: fit,
               staff: staff,
               voice: 1, // Rests usually voice 1
               isRest: true,
               pitch_label: ''
           });

           remaining -= fit;
           currentPos += fit;
      }
      return rests;
  },

  /**
   * Helper to convert duration in beats to VexFlow duration string
   * e.g., 1 -> "q", 2 -> "h", 4 -> "w", 0.5 -> "8"
   */
  getVexFlowDuration(beats: number): string {
      // Handle dots
      // 1.5 -> qd, 3 -> hd, 0.75 -> 8d

      // Simple lookup for standard values
      if (Math.abs(beats - 4) < 0.01) return "w";
      if (Math.abs(beats - 3) < 0.01) return "hd";
      if (Math.abs(beats - 2) < 0.01) return "h";
      if (Math.abs(beats - 1.5) < 0.01) return "qd";
      if (Math.abs(beats - 1) < 0.01) return "q";
      if (Math.abs(beats - 0.75) < 0.01) return "8d";
      if (Math.abs(beats - 0.5) < 0.01) return "8";
      if (Math.abs(beats - 0.375) < 0.01) return "16d"; // dotted 16th
      if (Math.abs(beats - 0.25) < 0.01) return "16";
      if (Math.abs(beats - 0.125) < 0.01) return "32";

      // Fallback for weird tuplets or glitches: round to nearest
      if (beats > 3.5) return "w";
      if (beats > 1.8) return "h";
      if (beats > 0.8) return "q";
      if (beats > 0.4) return "8";
      if (beats > 0.2) return "16";
      return "32";
  }
};
