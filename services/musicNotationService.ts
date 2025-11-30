
import { NoteEvent } from '../types';
import { formatPitch } from '../utils/pitchUtils';

// Constants
const GRID_DENOM = 32; // 1/32 note quantization
const BEATS_PER_MEASURE = 4; // Assuming 4/4 for now
const MIDDLE_C = 60;
const STAFF_SPACE = 10; // VexFlow default reference (approx)

/* Configurable constants for Staff/Slur/Beam logic */
const LEDGER_LIMIT = 3;          // max ledger lines acceptable on assigned staff
const FASTPATH_LOW = 53;         // move to bass if midi < 53 (approx 3 ledgers below treble)
const FASTPATH_HIGH = 69;        // move to treble if midi > 69 (approx 3 ledgers above bass)
const SLUR_GAP_BEATS = 1 / 32;   // gap threshold for slur detection (beats)
const SLUR_MAX_NOTES = 8;        // maximum slur length to auto-detect
const MIN_BEAMABLE = 0.5;        // durations <= this (eighth notes) are beamable
const BEAM_BREAK_AT_BEAT = true; // whether to break beams at beat boundaries

/* Mapping reference: middle-line MIDI approximations */
const TREBLE_MIDDLE_MIDI = 71; // B4 as middle line reference
const BASS_MIDDLE_MIDI = 50;   // D3 as middle line reference

export interface Measure {
  index: number;
  startBeat: number;
  endBeat: number;
  notes: NoteEvent[];
}

export interface StaffInfo {
  id: string;
  clef: 'treble' | 'bass';
  centerY?: number;
  staff_space?: number;
}

export const MusicNotationService = {
  /**
   * Main pipeline function to transform raw audio events into engraved-ready data
   */
  processNotes(rawNotes: NoteEvent[], bpm: number): Measure[] {
    if (rawNotes.length === 0) return [];

    // 0. Define Staves
    const staves: StaffInfo[] = [
        { id: 'treble', clef: 'treble' },
        { id: 'bass', clef: 'bass' }
    ];

    // 1. Quantization & Normalization
    const quantizedNotes = this.quantizeNotes(rawNotes, bpm);

    // 2. Measure Splitting (with Ties)
    // We split before staff assignment to ensuring long notes are broken into measures correctly
    // (User instructions allow splitting before or after, keeping before for grouping consistency)
    const splitNotes = this.splitAcrossMeasures(quantizedNotes);

    // 3. Staff Assignment (New Logic)
    this.assignStaves(splitNotes, staves);

    // 4. Group into Measures
    const measures = this.groupIntoMeasures(splitNotes);

    // 5. Voice Assignment & Slurs/Beams & Rests (Per Measure)
    measures.forEach(m => {
        // Voice Assignment (Strict Separation)
        this.assignVoices(m.notes);

        // Slurs & Beams (Strict Rules)
        this.detectSlursAndBeams(m.notes, BEATS_PER_MEASURE);

        // Fill Rests (Existing Logic)
        m.notes = this.fillMeasureWithRests(m.notes, m.startBeat, m.endBeat);
    });

    // 6. Global Validation & Fix Pass (New Logic)
    // We flatten measures to validate across the board or validate per measure if localized
    // Some checks (cross-staff slurs) are already impossible if we only group by staff, but let's check everything.
    this.validateAndFix(measures);

    return measures;
  },

  quantizeNotes(rawNotes: NoteEvent[], bpm: number): NoteEvent[] {
    return rawNotes.map(note => {
      const beatRaw = (note.start_time * bpm) / 60;
      const durationRaw = (note.duration * bpm) / 60;

      // Snap to 1/32 grid
      const startBeat = Math.round(beatRaw * GRID_DENOM) / GRID_DENOM;
      const durationBeats = Math.max(1/GRID_DENOM, Math.round(durationRaw * GRID_DENOM) / GRID_DENOM);

      // Calculate quantization error
      const error = Math.abs(startBeat - beatRaw);
      // Threshold: 35% of a grid step
      const isUncertain = error > (1 / GRID_DENOM) * 0.35;

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
        isUncertain,
        quantizeErrorBeats: error
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

  /**
   * Helper: approximate ledger-lines count for a staff for a given midi pitch
   */
  ledgerLinesForStaff(midi:number, clef: 'treble' | 'bass'): number {
      const middle = clef === 'treble' ? TREBLE_MIDDLE_MIDI : BASS_MIDDLE_MIDI;
      const semitoneDelta = midi - middle;
      const pos = Math.round(Math.abs(semitoneDelta) / 1);
      const positionsInside = 4;
      const extraPositions = Math.max(0, pos - positionsInside);
      const ledger = Math.ceil(extraPositions / 2);
      return ledger;
  },

  /**
   * Choose staff for a single midi pitch given available staves.
   */
  chooseStaffForMidi(midi:number, staves: StaffInfo[]): StaffInfo {
      if (!staves || staves.length === 0) throw new Error('chooseStaffForMidi: no staves provided');

      // 1) compute ledger-line cost
      const scored = staves.map(s => ({ staff: s, ledger: this.ledgerLinesForStaff(midi, s.clef) }));
      scored.sort((a,b) => a.ledger - b.ledger); // ascending ledger preference

      // Strict Rule: If smallest ledger cost ≤ 3, choose that staff.
      if (scored[0].ledger <= LEDGER_LIMIT) return scored[0].staff;

      // Strict Rule: If ledger cost > 3:
      // If midi_pitch < 53 → choose bass.
      if (midi < FASTPATH_LOW) {
          const bass = staves.find(s => s.clef === 'bass');
          if (bass) return bass;
      }
      // If midi_pitch > 69 → choose treble.
      if (midi > FASTPATH_HIGH) {
          const treble = staves.find(s => s.clef === 'treble');
          if (treble) return treble;
      }

      // Else choose the lower ledger cost.
      return scored[0].staff;
  },

  assignStaves(notes: NoteEvent[], staves: StaffInfo[]) {
      for (const n of notes) {
          if (typeof n.midi_pitch !== 'number') {
              // Preserve existing staff if present, else default to treble
              if (!n.staff) n.staff = 'treble';
              continue;
          }
          const chosen = this.chooseStaffForMidi(n.midi_pitch, staves);
          n.staff = chosen.clef;
      }
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
      ['treble', 'bass'].forEach(staffType => {
          const staffNotes = notes.filter(n => n.staff === staffType);
          if (staffNotes.length === 0) return;

          // Default all to Voice 1
          staffNotes.forEach(note => note.voice = 1);

          // Identify overlaps
          for (let i = 0; i < staffNotes.length; i++) {
              const current = staffNotes[i];
              const overlapping = staffNotes.filter(other =>
                  other !== current &&
                  other.startBeat! < (current.startBeat! + current.durationBeats!) &&
                  (other.startBeat! + other.durationBeats!) > current.startBeat!
              );

              if (overlapping.length > 0) {
                  // Strict Rule: Overlapping notes on the same staff require separation into two voices.
                  // Voice separation must ensure: No overlapping stems, noteheads, durations.

                  // Strategy: Assign current to Voice 1 if it starts earlier or is higher pitch (standard engraving heuristic),
                  // otherwise Voice 2.
                  // However, simplistic overlap check needs to be robust.

                  // Simple greedy approach:
                  // If I overlap with something that is already Voice 1, I become Voice 2.
                  // If I overlap with something that is already Voice 2, I become Voice 1 (if possible, else chaos).

                  // Sort by pitch descending (high to low)
                  // Higher pitch usually gets Voice 1 (Stem Up).

                  const involved = [current, ...overlapping].sort((a,b) => b.midi_pitch - a.midi_pitch);

                  // Assign voices in order: Voice 1, Voice 2...
                  // But wait, chords (same start time) should share a voice.

                  // Filter out chords (same start time)
                  const nonChordOverlaps = overlapping.filter(o => Math.abs(o.startBeat! - current.startBeat!) >= 0.001);

                  if (nonChordOverlaps.length > 0) {
                      // There is a rhythmic overlap (polyphony)
                      // We need to determine who gets Voice 1 and Voice 2.

                      // Check if 'current' has already been forced to Voice 2 by a previous iteration?
                      // It's safer to do a pass that groups independent melodic lines, but that's complex.

                      // Let's use the pitch rule locally:
                      // If 'current' is the higher pitch of the overlapping pair -> Voice 1.
                      // If 'current' is the lower pitch -> Voice 2.

                      // Note: This needs to be consistent.
                      // Let's check against all overlapping notes.

                      let lowerThanCount = 0;
                      let higherThanCount = 0;

                      nonChordOverlaps.forEach(other => {
                          if (other.midi_pitch > current.midi_pitch) lowerThanCount++;
                          else higherThanCount++;
                      });

                      // If I am lower than someone, I should probably be Voice 2.
                      if (lowerThanCount > 0) {
                          current.voice = 2;
                      } else {
                          current.voice = 1;
                      }

                      // Tie-breaking or complex multi-voice: defaults to 1 or 2.
                      // Instructions say: Voice 1 (stem up), Voice 2 (stem down).
                  }
              }
          }
      });
  },

  detectSlursAndBeams(notes: NoteEvent[], beatsPerMeasure: number) {
      const slurGroups: Record<string, string[]> = {};
      const beamGroups: Record<string, string[]> = {};

      // Clear existing assignments
      notes.forEach(n => {
          n.slurId = null;
          n.beamId = null;
      });

      // Group notes by staff+voice+measure for slurs (voice-aware)
      const byVoiceMeasure = new Map<string, NoteEvent[]>();
      for (const n of notes) {
          const voice = (n.voice ?? 1);
          const staff = n.staff ?? 'treble';
          const measureIndex = Math.floor(n.startBeat! / beatsPerMeasure);
          const key = `${staff}|${voice}|m${measureIndex}`;
          if (!byVoiceMeasure.has(key)) byVoiceMeasure.set(key, []);
          byVoiceMeasure.get(key)!.push(n);
      }

      // SLUR DETECTION
      let slurIdCounter = 0;
      for (const [key, arr] of byVoiceMeasure.entries()) {
          // Sort strictly by time
          arr.sort((a,b) => a.startBeat! - b.startBeat! || (b.midi_pitch - a.midi_pitch));

          let currentGroup: NoteEvent[] = [];

          for (let i = 0; i < arr.length; i++) {
              const cur = arr[i];

              // Rule: Single notes only, not chords.
              // Check if 'cur' is part of a chord.
              const isChord = arr.some(o => o !== cur && Math.abs(o.startBeat! - cur.startBeat!) < 0.001);
              if (isChord) {
                  // Break current slur if any
                  if (currentGroup.length > 1) {
                      const id = `slur_${slurIdCounter++}`;
                      for (const x of currentGroup) x.slurId = id;
                  }
                  currentGroup = [];
                  continue;
              }

              if (currentGroup.length === 0) { currentGroup.push(cur); continue; }
              const prev = currentGroup[currentGroup.length - 1];

              const prevEnd = prev.startBeat! + prev.durationBeats!;
              const gap = cur.startBeat! - prevEnd;

              // Rule: Time gap ≤ 1/32 beat
              // Rule: Same measure (guaranteed by grouping)
              // Rule: Same voice (guaranteed by grouping)
              // Rule: Same staff (guaranteed by grouping)

              if (gap <= SLUR_GAP_BEATS && cur.startBeat! >= prev.startBeat!) {
                  currentGroup.push(cur);
                  if (currentGroup.length >= SLUR_MAX_NOTES) {
                      const id = `slur_${slurIdCounter++}`;
                      for (const x of currentGroup) x.slurId = id;
                      currentGroup = [];
                  }
              } else {
                  if (currentGroup.length > 1) {
                      const id = `slur_${slurIdCounter++}`;
                      for (const x of currentGroup) x.slurId = id;
                  }
                  currentGroup = [cur];
              }
          }
          if (currentGroup.length > 1) {
              const id = `slur_${slurIdCounter++}`;
              for (const x of currentGroup) x.slurId = id;
          }
      }

      // BEAM GROUPS
      const beamableNotesByContext = new Map<string, NoteEvent[]>();
      for (const n of notes) {
          // Rule: Only notes with duration <= 1/8 (0.5 beat) are beamable.
          if (n.durationBeats! <= MIN_BEAMABLE) {
              const v = (n.voice ?? 1);
              const context = `${n.staff ?? 'treble'}|${v}|m${Math.floor(n.startBeat! / beatsPerMeasure)}`;
              if (!beamableNotesByContext.has(context)) beamableNotesByContext.set(context, []);
              beamableNotesByContext.get(context)!.push(n);
          }
      }

      let beamIdCounter = 0;
      for (const [ctx, arr] of beamableNotesByContext.entries()) {
          const sorted = arr.slice().sort((a,b) => a.startBeat! - b.startBeat! || b.midi_pitch - a.midi_pitch);
          let currentBeam: NoteEvent[] = [];
          for (let i = 0; i < sorted.length; i++) {
              const cur = sorted[i];
              if (currentBeam.length === 0) { currentBeam.push(cur); continue; }
              const prev = currentBeam[currentBeam.length - 1];

              const sameTick = Math.abs(cur.startBeat! - prev.startBeat!) < (1 / (GRID_DENOM * 100));
              const prevBeatIndex = Math.floor(prev.startBeat!);
              const curBeatIndex = Math.floor(cur.startBeat!);
              const crossesBeat = BEAM_BREAK_AT_BEAT && (prevBeatIndex !== curBeatIndex);
              const gap = cur.startBeat! - (prev.startBeat! + prev.durationBeats!);
              const beamGapTolerance = 1 / GRID_DENOM;

              if (sameTick || (!crossesBeat && gap <= beamGapTolerance)) {
                  currentBeam.push(cur);
              } else {
                  if (currentBeam.length >= 2) {
                      const id = `beam_${beamIdCounter++}`;
                      for (const x of currentBeam) x.beamId = id;
                  }
                  currentBeam = [cur];
              }
          }
          if (currentBeam.length >= 2) {
              const id = `beam_${beamIdCounter++}`;
              for (const x of currentBeam) x.beamId = id;
          }
      }
  },

  validateAndFix(measures: Measure[]) {
      measures.forEach(m => {
          m.notes.forEach(note => {
              // Rule: No slur spans across staves (implicit by construction but good to check)
              // Rule: No slur spans across voices (implicit by construction)

              // Validate Ledger Lines <= 3 (Service Level Check)
              if (note.midi_pitch) {
                  const clef = note.staff as 'treble' | 'bass';
                  const ledger = this.ledgerLinesForStaff(note.midi_pitch, clef);
                  if (ledger > LEDGER_LIMIT) {
                      if (!note.remediationFlags) note.remediationFlags = [];
                      note.remediationFlags.push(`excess_ledger_lines_${ledger}`);
                      // Here we could forcefully re-assign staff, but that might violate the split point rules.
                      // For now, we flag it.
                  }
              }

              // Validate Slurs
              if (note.slurId) {
                  // Check if slur group is valid
                  // Find all notes in this slur group (within the measure)
                  const group = m.notes.filter(n => n.slurId === note.slurId);

                  // Check constraints
                  const staves = new Set(group.map(n => n.staff));
                  const voices = new Set(group.map(n => n.voice));

                  if (staves.size > 1) {
                      // Cross-staff slur detected -> Remove it
                      group.forEach(n => {
                          n.slurId = null;
                          if (!n.remediationFlags) n.remediationFlags = [];
                          n.remediationFlags.push('slur_removed_cross_staff');
                      });
                  }

                  if (voices.size > 1) {
                      // Cross-voice slur detected -> Remove it
                      group.forEach(n => {
                          n.slurId = null;
                          if (!n.remediationFlags) n.remediationFlags = [];
                          n.remediationFlags.push('slur_removed_cross_voice');
                      });
                  }

                  // Check for chords in slur
                  const hasChords = group.some(n => {
                      const sameTime = group.filter(x => Math.abs(x.startBeat! - n.startBeat!) < 0.001);
                      return sameTime.length > 1;
                  });
                  if (hasChords) {
                      group.forEach(n => {
                          n.slurId = null;
                          if (!n.remediationFlags) n.remediationFlags = [];
                          n.remediationFlags.push('slur_removed_has_chord');
                      });
                  }
              }
          });

          // Validate Measure Duration (Sum)
          // Just a check for now, fixing it would require re-generating rests
      });
  },

  fillMeasureWithRests(notes: NoteEvent[], measureStart: number, measureEnd: number): NoteEvent[] {
      const filledNotes = [...notes];

      ['treble', 'bass'].forEach(staff => {
          const staffNotes = notes.filter(n => n.staff === staff && n.voice === 1);
          staffNotes.sort((a,b) => a.startBeat! - b.startBeat!);

          let cursor = measureStart;

          if (staffNotes.length > 0) {
               if (staffNotes[0].startBeat! > cursor) {
                   const gaps = this.generateRestEvents(cursor, staffNotes[0].startBeat!, staff as 'treble'|'bass');
                   filledNotes.push(...gaps);
               }
               cursor = staffNotes[0].startBeat! + staffNotes[0].durationBeats!;
          }

          for (let i = 0; i < staffNotes.length - 1; i++) {
              const currentEnd = staffNotes[i].startBeat! + staffNotes[i].durationBeats!;
              const nextStart = staffNotes[i+1].startBeat!;
              if (nextStart > currentEnd + 0.001) {
                  const gaps = this.generateRestEvents(currentEnd, nextStart, staff as 'treble'|'bass');
                  filledNotes.push(...gaps);
              }
          }

          if (staffNotes.length > 0) {
              const lastEnd = staffNotes[staffNotes.length-1].startBeat! + staffNotes[staffNotes.length-1].durationBeats!;
              if (lastEnd < measureEnd - 0.001) {
                   const gaps = this.generateRestEvents(lastEnd, measureEnd, staff as 'treble'|'bass');
                   filledNotes.push(...gaps);
              }
          } else {
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

      const denoms = [4, 2, 1, 0.5, 0.25, 0.125, 0.03125];

      while (remaining >= 0.03125) {
           const fit = denoms.find(d => d <= remaining + 0.001);
           if (!fit) break;

           rests.push({
               id: `rest_${staff}_${currentPos}_${Math.random()}`,
               start_time: 0,
               duration: 0,
               midi_pitch: 0,
               velocity: 0,
               confidence: 1,
               startBeat: currentPos,
               durationBeats: fit,
               staff: staff,
               voice: 1,
               isRest: true,
               pitch_label: ''
           });

           remaining -= fit;
           currentPos += fit;
      }
      return rests;
  },

  getVexFlowDuration(beats: number): string {
      if (Math.abs(beats - 4) < 0.01) return "w";
      if (Math.abs(beats - 3) < 0.01) return "hd";
      if (Math.abs(beats - 2) < 0.01) return "h";
      if (Math.abs(beats - 1.5) < 0.01) return "qd";
      if (Math.abs(beats - 1) < 0.01) return "q";
      if (Math.abs(beats - 0.75) < 0.01) return "8d";
      if (Math.abs(beats - 0.5) < 0.01) return "8";
      if (Math.abs(beats - 0.375) < 0.01) return "16d";
      if (Math.abs(beats - 0.25) < 0.01) return "16";
      if (Math.abs(beats - 0.125) < 0.01) return "32";

      if (beats > 3.5) return "w";
      if (beats > 1.8) return "h";
      if (beats > 0.8) return "q";
      if (beats > 0.4) return "8";
      if (beats > 0.2) return "16";
      return "32";
  }
};
