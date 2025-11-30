
import React, { useEffect, useRef, useMemo } from 'react';
import {
    Renderer,
    Stave,
    StaveNote,
    StaveConnector,
    Accidental,
    Dot,
    Formatter,
    Voice,
    Beam,
    Curve,
    StaveTie,
    Annotation,
    Modifier,
    Font,
    Fraction,
} from 'vexflow';
import { NoteEvent, LabelSettings } from '../types';
import { MusicNotationService } from '../services/musicNotationService';

interface SheetMusicProps {
  notes: NoteEvent[];
  currentTime: number;
  totalDuration: number;
  bpm?: number;
  onNoteClick: (noteId: string) => void;
  selectedNoteId: string | null;
  labelSettings: LabelSettings;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

const SheetMusic: React.FC<SheetMusicProps> = ({ 
    notes, currentTime, totalDuration, bpm = 120, onNoteClick, selectedNoteId, labelSettings, scrollRef, onScroll 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  // Constants
  const BASE_MEASURE_WIDTH = 220; // Recommended minimum
  const STAFF_SPACE = 10;
  
  // Memoize measures for rendering efficiency and to use in axis generation
  const { measures, diagnostics } = useMemo(() => {
      const result = MusicNotationService.processNotes(notes, bpm);
      // Log diagnostics for QA visibility
      if (result.diagnostics.slurValidation.totalSlursAttempted > 0) {
          console.log('[SlurValidation]', result.diagnostics.slurValidation);
      }
      return result;
  }, [notes, bpm]);

  // Logic: Sync scroll to playhead
  useEffect(() => {
    if (scrollRef && scrollRef.current) {
        const beatsPerSecond = bpm / 60;
        const currentBeat = currentTime * beatsPerSecond;
        const pixelsPerBeat = BASE_MEASURE_WIDTH / 4; // approximate
        
        // Offset: First stave padding (~20px)
        const playheadX = 20 + (currentBeat * pixelsPerBeat);
        
        const containerWidth = scrollRef.current.clientWidth;
        const targetScroll = playheadX - (containerWidth / 2);
        
        // Only scroll if deviation is significant to allow manual scrolling
        if (Math.abs(scrollRef.current.scrollLeft - targetScroll) > 50) { 
           scrollRef.current.scrollTo({
               left: Math.max(0, targetScroll),
               behavior: 'smooth'
           });
        }
    }
  }, [currentTime, bpm, scrollRef]);

  // Logic: Render VexFlow
  useEffect(() => {
      if (!containerRef.current) return;
      if (notes.length === 0) return;

      // 1. Clear previous
      while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild);
      }

      // 2. Setup VexFlow Renderer
      const totalWidth = measures.reduce((acc, m) => {
          // Dynamic width calculation (Exact Formula)
          // measureWidth = max(220px, 220px + (noteDensity * staff_space * 16))
          const noteCount = m.notes.length;
          const noteDensity = noteCount / 4; // beatsPerMeasure = 4
          const dynamicWidth = Math.max(220, 220 + (noteDensity * STAFF_SPACE * 16));
          return acc + dynamicWidth;
      }, 0);
      
      const width = Math.max(800, totalWidth + 50);
      const height = 350; // Treble + Bass + spacing

      const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      rendererRef.current = renderer;

      // Styling
      context.setFont("Inter", 10, "").setBackgroundFillStyle("#ffffff");

      // 3. Render Measures Loop
      let currentX = 10;
      
      measures.forEach((measure, i) => {
          // Calculate Dynamic Width for this measure (Exact Formula)
          const noteCount = measure.notes.length;
          const noteDensity = noteCount / 4; // beatsPerMeasure
          const dynamicWidth = Math.max(220, 220 + (noteDensity * STAFF_SPACE * 16));

          // --- TREBLE STAVE ---
          const staveTreble = new Stave(currentX, 40, dynamicWidth);
          if (i === 0) {
              staveTreble.addClef("treble").addTimeSignature("4/4");
          }
          staveTreble.setContext(context).draw();

          // --- BASS STAVE ---
          const staveBass = new Stave(currentX, 160, dynamicWidth); // Spacing
          if (i === 0) {
              staveBass.addClef("bass").addTimeSignature("4/4");
          }
          staveBass.setContext(context).draw();

          // Connect staves with brace at start
          if (i === 0) {
              new StaveConnector(staveTreble, staveBass).setType(StaveConnector.type.BRACE).setContext(context).draw();
              new StaveConnector(staveTreble, staveBass).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
          }
          // Barline at end
          new StaveConnector(staveTreble, staveBass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();

          // --- NOTES GENERATION HELPER ---
          const createVexNotes = (measureNotes: NoteEvent[], clef: string) => {
              if (measureNotes.length === 0) return [];

              // Group by start time for chords
              const groups: {[key: number]: NoteEvent[]} = {};
              measureNotes.forEach(n => {
                  const t = n.startBeat!;
                  if (!groups[t]) groups[t] = [];
                  groups[t].push(n);
              });

              const vfNotes: StaveNote[] = [];
              const sortedTimes = Object.keys(groups).map(Number).sort((a,b) => a-b);
              
              sortedTimes.forEach((time, idx) => {
                  const group = groups[time];
                  const durBeats = group[0].durationBeats || 1;
                  const isRest = group[0].isRest;
                  const voiceId = group[0].voice || 1;

                  let vfDur = MusicNotationService.getVexFlowDuration(durBeats);
                  if (isRest) vfDur += "r";

                  // Keys
                  let keys: string[] = [];
                  if (isRest) {
                      keys = [clef === 'treble' ? "b/4" : "d/3"];
                  } else {
                      // Sort keys Ascending for StaveNote construction
                      const sortedGroup = [...group].sort((a,b) => a.midi_pitch - b.midi_pitch);
                      keys = sortedGroup.map(n => {
                          const noteLetter = n.pitch_label?.charAt(0).toLowerCase() || "c";
                          const octave = Math.floor(n.midi_pitch / 12) - 1;
                          return `${noteLetter}/${octave}`;
                      });
                  }

                  const staveNote = new StaveNote({
                      keys,
                      duration: vfDur,
                      clef,
                      // Force Stem Direction
                      stem_direction: voiceId === 2 ? StaveNote.STEM_DOWN : StaveNote.STEM_UP
                  });

                  // Metadata for mapping back
                  // @ts-ignore
                  staveNote.sourceData = group;

                  // Styling
                  const isSelected = group.some(n => n.id === selectedNoteId);
                  if (isSelected) staveNote.setStyle({ fillStyle: "#4f46e5", strokeStyle: "#4f46e5" });

                  // Uncertainty Visualization
                  const isUncertain = group.some(n => n.isUncertain);
                  if (isUncertain) {
                      // Use a visual indicator for uncertainty
                      staveNote.setStyle({ fillStyle: "#f97316", strokeStyle: "#f97316" }); // Orange color
                  }

                  if (!isRest) {
                      // --- ACCIDENTALS & DOTS ---
                      const sortedGroup = [...group].sort((a,b) => a.midi_pitch - b.midi_pitch);
                      sortedGroup.forEach((n, i) => {
                          const noteName = n.pitch_label || "";
                          if (noteName.includes("#") || noteName.includes("♯")) {
                              staveNote.addModifier(new Accidental("#"), i);
                          } else if (noteName.includes("b") || noteName.includes("♭")) {
                              staveNote.addModifier(new Accidental("b"), i);
                          } else if (noteName.includes("x")) {
                              staveNote.addModifier(new Accidental("##"), i);
                          }

                          // Dots
                          if (vfDur.includes("d")) {
                              staveNote.addModifier(new Dot(), i);
                          }
                      });

                      // --- PITCH LABELS (Stacked High -> Low) ---
                      if (labelSettings.showLabels) {
                          // Deduplicate labels per chord (by midi pitch)
                          const uniqueNotes = new Map<number, NoteEvent>();
                          group.forEach(n => uniqueNotes.set(n.midi_pitch, n));
                          // Sort descending (High -> Low) for label rendering
                          const sortedDesc = Array.from(uniqueNotes.values()).sort((a,b) => b.midi_pitch - a.midi_pitch);

                          sortedDesc.forEach((n, labelIdx) => {
                               const labelText = n.pitch_label || "";
                               const annotation = new Annotation(labelText)
                                  .setFont("Inter", 9, "bold")
                                  .setVerticalJustification(
                                      voiceId === 2
                                      ? Annotation.VerticalJustify.BOTTOM
                                      : Annotation.VerticalJustify.TOP
                                  );

                               // Find index in staveNote keys (which are Ascending)
                               const keyIndex = sortedGroup.findIndex(g => g.midi_pitch === n.midi_pitch);
                               if (keyIndex !== -1) {
                                  staveNote.addModifier(annotation, keyIndex);
                               }
                          });
                      }
                  } else {
                      // Rest Padding/Collision Avoidance check (basic)
                      // VexFlow StaveNote for rest centers itself usually.
                  }

                  vfNotes.push(staveNote);
              });

              return vfNotes;
          };

          // Separate voices per stave
          const t1Notes = measure.notes.filter(n => n.staff === 'treble' && n.voice === 1);
          const t2Notes = measure.notes.filter(n => n.staff === 'treble' && n.voice === 2);
          const b1Notes = measure.notes.filter(n => n.staff === 'bass' && n.voice === 1);
          const b2Notes = measure.notes.filter(n => n.staff === 'bass' && n.voice === 2);

          const voices: Voice[] = [];
          const staveMap: Stave[] = []; // Track which stave each voice belongs to

          const addVoice = (notes: NoteEvent[], clef: string, stave: Stave) => {
              if (notes.length === 0) return;
              const vfNotes = createVexNotes(notes, clef);
              const voice = new Voice({ num_beats: 4, beat_value: 4 }).setMode(Voice.Mode.SOFT);
              voice.addTickables(vfNotes);
              voices.push(voice);
              staveMap.push(stave);
          };

          addVoice(t1Notes, "treble", staveTreble);
          addVoice(t2Notes, "treble", staveTreble);
          addVoice(b1Notes, "bass", staveBass);
          addVoice(b2Notes, "bass", staveBass);

          // FORMATTER
          // Use formatToStave for best alignment
          const formatter = new Formatter();
          formatter.joinVoices(voices);

          // Format based on the first stave width (assuming aligned)
          formatter.formatToStave(voices, staveTreble);

          // DRAW
          voices.forEach((v, idx) => {
              const stave = staveMap[idx];
              v.setStave(stave);
              v.draw(context, stave);
          });

          // BEAMS (Auto-Generate)
          voices.forEach(voice => {
              const tickables = voice.getTickables();
              // Generate beams automatically
              // @ts-ignore
              const beams = Beam.generateBeams(tickables, {
                  beam_rests: false,
                  beam_middle_only: true,
                  maintain_stem_directions: true,
                  groups: [new Fraction(2, 8)] // Beam in quarter note groups
              });

              beams.forEach(b => {
                  b.setContext(context).draw();
              });
          });

          // TIES & SLURS
          // We iterate voices to find connections
          voices.forEach(voice => {
              const tickables = voice.getTickables() as StaveNote[];
              tickables.forEach((t, j) => {
                  // @ts-ignore
                  const sourceData = t.sourceData as NoteEvent[];
                  if (!sourceData) return;
                  const n = sourceData[0]; // Logic for first note of chord

                  // Ties
                  if (n.tie === 'start' || n.tie === 'continue') {
                      if (j < tickables.length - 1) {
                          const nextT = tickables[j+1];
                          new StaveTie({
                              first_note: t,
                              last_note: nextT,
                              first_indices: [0],
                              last_indices: [0]
                          }).setContext(context).draw();
                      }
                  }

                  // Slurs (using slurId)
                  if (n.slurId) {
                      // Check if start of slur group
                      // Is previous note in same slur group?
                      const prevT = j > 0 ? tickables[j-1] : null;
                      // @ts-ignore
                      const prevN = prevT ? prevT.sourceData?.[0] : null;

                      if (!prevN || prevN.slurId !== n.slurId) {
                          // This is start. Find end.
                          let k = j;
                          let lastInGroup = t;
                          while (k < tickables.length) {
                              const curr = tickables[k];
                              // @ts-ignore
                              const currN = curr.sourceData?.[0];
                              if (currN && currN.slurId === n.slurId) {
                                  lastInGroup = curr;
                                  k++;
                              } else {
                                  break;
                              }
                          }

                          if (lastInGroup !== t) {
                               new Curve(t, lastInGroup, {
                                   cps: [{ x: 0, y: 10 }, { x: 0, y: 10 }]
                               }).setContext(context).draw();
                          }
                      }
                  }
              });
          });
          
          currentX += dynamicWidth;
      });
      
  }, [measures, bpm, labelSettings, selectedNoteId]);

  // Calculate Cursor Position directly
  const cursorLeft = useMemo(() => {
      const beatsPerSecond = bpm / 60;
      const currentBeat = currentTime * beatsPerSecond;

      let x = 30; // initial padding
      let remainingBeats = currentBeat;

      for (const m of measures) {
          const mDuration = 4; // 4/4
          const noteCount = m.notes.length;
          const noteDensity = noteCount / 4;
          const mWidth = Math.max(BASE_MEASURE_WIDTH, 220 + (noteDensity * STAFF_SPACE * 16));

          if (remainingBeats <= mDuration) {
              x += (remainingBeats / mDuration) * mWidth;
              remainingBeats = 0;
              break;
          } else {
              x += mWidth;
              remainingBeats -= mDuration;
          }
      }
      return x;
  }, [currentTime, bpm, measures]);

  return (
    <div 
        ref={scrollRef}
        onScroll={onScroll}
        className="w-full h-[400px] overflow-x-auto bg-white rounded-t-2xl shadow-sm relative select-none flex"
    >
        <div className="relative min-h-full min-w-max">
            <div ref={containerRef} className="h-full bg-white" />
            
            {/* Playhead Cursor */}
            <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none transition-all duration-75 ease-linear"
                style={{ 
                    left: `${cursorLeft}px`,
                    top: '20px',
                    height: '340px',
                    boxShadow: '0 0 4px rgba(239, 68, 68, 0.6)'
                }}
            >
                <div className="absolute -top-1 -left-[3px] w-2 h-2 bg-red-500 rounded-full shadow-md"></div>
            </div>
        </div>
    </div>
  );
};

export default SheetMusic;
