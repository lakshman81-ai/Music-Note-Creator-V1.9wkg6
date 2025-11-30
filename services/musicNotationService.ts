
import { NoteEvent } from '../types';
import { formatPitch } from '../utils/pitchUtils';

// Constants
const GRID_DENOM = 32; // 1/32 note quantization
const BEATS_PER_MEASURE = 4; // Assuming 4/4 for now
const MIDDLE_C = 60;

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

    // 1. Normalize & Quantize
    const quantizedNotes = rawNotes.map(note => {
      // Time Mapping: seconds -> beats
      const beatRaw = (note.start_time * bpm) / 60;
      const durationRaw = (note.duration * bpm) / 60;

      // Quantization: Snap to grid
      const startBeat = Math.round(beatRaw * GRID_DENOM) / GRID_DENOM;
      // Ensure minimum duration of 1/32
      const durationBeats = Math.max(1/GRID_DENOM, Math.round(durationRaw * GRID_DENOM) / GRID_DENOM);

      // Pitch Labeling (if missing)
      let label = note.pitch_label;
      if (!label) {
        const fmt = formatPitch(note.midi_pitch, { 
            format: 'scientific', 
            accidentalStyle: 'sharp', 
            showOctave: true,
        });
        label = fmt.display;
      }

      // Staff Assignment (Simple Split)
      const staff = note.midi_pitch >= MIDDLE_C ? 'treble' : 'bass';

      return {
        ...note,
        startBeat,
        durationBeats,
        pitch_label: label,
        staff
      } as NoteEvent;
    });

    // 2. Measure Splitting
    // Find total duration in beats
    const lastNote = quantizedNotes[quantizedNotes.length - 1];
    const totalBeats = lastNote.startBeat! + lastNote.durationBeats!;
    const totalMeasures = Math.ceil(totalBeats / BEATS_PER_MEASURE);

    const measures: Measure[] = [];
    
    for (let i = 0; i < totalMeasures; i++) {
        const measureStart = i * BEATS_PER_MEASURE;
        const measureEnd = (i + 1) * BEATS_PER_MEASURE;
        
        // Filter notes that START in this measure
        // (Advanced: Handle notes crossing measure boundaries via ties - simplified here to truncate/fit)
        const measureNotes = quantizedNotes.filter(n => 
            n.startBeat! >= measureStart && n.startBeat! < measureEnd
        );

        // Sort by start beat
        measureNotes.sort((a, b) => a.startBeat! - b.startBeat! || a.midi_pitch - b.midi_pitch);

        measures.push({
            index: i,
            startBeat: measureStart,
            endBeat: measureEnd,
            notes: measureNotes
        });
    }

    return measures;
  },

  /**
   * Helper to convert duration in beats to VexFlow duration string
   * e.g., 1 -> "q", 2 -> "h", 4 -> "w", 0.5 -> "8"
   */
  getVexFlowDuration(beats: number): string {
      // VexFlow: w=4, h=2, q=1, 8=0.5, 16=0.25, 32=0.125
      if (beats >= 4) return "w";
      if (beats >= 3) return "hd"; // dotted half
      if (beats >= 2) return "h";
      if (beats >= 1.5) return "qd";
      if (beats >= 1) return "q";
      if (beats >= 0.75) return "8d";
      if (beats >= 0.5) return "8";
      if (beats >= 0.25) return "16";
      return "32";
  }
};
