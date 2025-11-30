
import React, { useEffect, useRef, useMemo } from 'react';
import * as Vex from 'vexflow';
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
  // @ts-ignore
  const rendererRef = useRef<Vex.Flow.Renderer | null>(null);

  // Constants
  const MEASURE_WIDTH = 250;
  
  // Memoize measures for rendering efficiency and to use in axis generation
  const measures = useMemo(() => {
      return MusicNotationService.processNotes(notes, bpm);
  }, [notes, bpm]);

  // Logic: Sync scroll to playhead
  useEffect(() => {
    if (scrollRef && scrollRef.current) {
        const beatsPerSecond = bpm / 60;
        const currentBeat = currentTime * beatsPerSecond;
        const pixelsPerBeat = MEASURE_WIDTH / 4;
        
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
      // VexFlow 4.x ESM export handling - Robust Check
      // @ts-ignore
      const VF = Vex.Flow || (Vex.default && Vex.default.Flow) || Vex;
      
      if (!VF || !VF.Renderer) {
          console.error("VexFlow library not loaded correctly", Vex);
          return;
      }

      const width = Math.max(800, measures.length * MEASURE_WIDTH + 50);
      const height = 280; // Treble + Bass + spacing

      const renderer = new VF.Renderer(containerRef.current, VF.Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      rendererRef.current = renderer;

      // Styling
      context.setFont("Inter", 10, "").setBackgroundFillStyle("#ffffff");

      // 3. Render Measures Loop
      let currentX = 10;
      
      measures.forEach((measure, i) => {
          // --- TREBLE STAVE ---
          const staveTreble = new VF.Stave(currentX, 20, MEASURE_WIDTH);
          if (i === 0) {
              staveTreble.addClef("treble").addTimeSignature("4/4");
          }
          staveTreble.setContext(context).draw();

          // --- BASS STAVE ---
          const staveBass = new VF.Stave(currentX, 130, MEASURE_WIDTH); // 130y offset
          if (i === 0) {
              staveBass.addClef("bass").addTimeSignature("4/4");
          }
          staveBass.setContext(context).draw();

          // Connect staves with brace at start
          if (i === 0) {
              new VF.StaveConnector(staveTreble, staveBass).setType(VF.StaveConnector.type.BRACE).setContext(context).draw();
              new VF.StaveConnector(staveTreble, staveBass).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
          }
          // Barline at end
          new VF.StaveConnector(staveTreble, staveBass).setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();


          // --- NOTES GENERATION ---
          // Filter notes for this measure
          const trebleNotes = measure.notes.filter(n => n.staff === 'treble');
          const bassNotes = measure.notes.filter(n => n.staff === 'bass');

          const createVexNotes = (measureNotes: NoteEvent[], clef: string) => {
              if (measureNotes.length === 0) {
                  // Full measure rest
                  return [new VF.StaveNote({ clef, keys: [clef === 'treble' ? "b/4" : "d/3"], duration: "wr" })];
              }

              // Group by start time for chords
              const groups: {[key: number]: NoteEvent[]} = {};
              measureNotes.forEach(n => {
                  const t = n.startBeat!;
                  if (!groups[t]) groups[t] = [];
                  groups[t].push(n);
              });

              const vfNotes: any[] = [];
              const sortedTimes = Object.keys(groups).map(Number).sort((a,b) => a-b);
              
              sortedTimes.forEach((time, idx) => {
                  const group = groups[time];
                  // Determine Duration based on first note in group
                  const durBeats = group[0].durationBeats || 1;
                  const vfDur = MusicNotationService.getVexFlowDuration(durBeats);

                  // Keys: "c/4", "eb/5"
                  const keys = group.map(n => {
                      // MIDI to Note Name
                      // Fix: robustly handle unicode pitch labels (e.g. D♯4) by taking first char only
                      const noteLetter = n.pitch_label?.charAt(0).toLowerCase() || "c";
                      const octave = Math.floor(n.midi_pitch / 12) - 1;
                      return `${noteLetter}/${octave}`;
                  });

                  // Modifiers (Accidentals)
                  const staveNote = new VF.StaveNote({ keys, duration: vfDur, clef });
                  
                  // Color selection
                  const isSelected = group.some(n => n.id === selectedNoteId);
                  if (isSelected) staveNote.setStyle({ fillStyle: "#4f46e5", strokeStyle: "#4f46e5" });

                  // Apply Accidentals
                  group.forEach((n, idx) => {
                      const noteName = n.pitch_label || "";
                      // Handle both ASCII and Unicode accidentals
                      if (noteName.includes("#") || noteName.includes("♯")) {
                          staveNote.addModifier(new VF.Accidental("#"), idx);
                      }
                      if (noteName.includes("b") || noteName.includes("♭")) {
                          staveNote.addModifier(new VF.Accidental("b"), idx);
                      }
                      if (noteName.includes("x")) {
                          staveNote.addModifier(new VF.Accidental("##"), idx);
                      }
                  });

                  // Pitch Labels (Annotations)
                  if (labelSettings.showLabels) {
                      group.forEach((n, idx) => {
                          const label = n.pitch_label || "";
                          const position = clef === 'treble' ? VF.Modifier.Position.ABOVE : VF.Modifier.Position.BELOW;
                          
                          const annotation = new VF.Annotation(label)
                              .setFont("Inter", 9, "normal") // Sans-serif, small
                              .setVerticalJustification(position === VF.Modifier.Position.ABOVE ? VF.Annotation.VerticalJustify.BOTTOM : VF.Annotation.VerticalJustify.TOP);
                          
                          staveNote.addModifier(annotation, idx);
                      });
                  }
                  
                  vfNotes.push(staveNote);
              });

              return vfNotes;
          };

          const vNotesTreble = createVexNotes(trebleNotes, "treble");
          const vNotesBass = createVexNotes(bassNotes, "bass");

          // Create Voices
          const voiceTreble = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
          voiceTreble.addTickables(vNotesTreble);

          const voiceBass = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
          voiceBass.addTickables(vNotesBass);

          // Format and Draw
          // Align treble and bass
          new VF.Formatter()
              .joinVoices([voiceTreble])
              .joinVoices([voiceBass])
              .format([voiceTreble, voiceBass], MEASURE_WIDTH - 50);

          voiceTreble.draw(context, staveTreble);
          voiceBass.draw(context, staveBass);
          
          currentX += MEASURE_WIDTH;
      });
      
  }, [measures, bpm, labelSettings, selectedNoteId]);

  // Calculate Cursor Position directly for smooth updates
  const cursorLeft = useMemo(() => {
      const beatsPerSecond = bpm / 60;
      const currentBeat = currentTime * beatsPerSecond;
      const pixelsPerBeat = MEASURE_WIDTH / 4; 
      // 10px margin + 20px padding approximation for the start
      return 30 + (currentBeat * pixelsPerBeat);
  }, [currentTime, bpm]);

  return (
    <div 
        ref={scrollRef}
        onScroll={onScroll}
        className="w-full h-[320px] overflow-x-auto bg-white rounded-t-2xl shadow-sm relative select-none flex"
    >
        {/* Wrapper to hold relative content */}
        <div className="relative min-h-full min-w-max">
            {/* VexFlow Container */}
            <div ref={containerRef} className="h-full bg-white" />
            
            {/* Time Axis Overlay */}
            {measures.length > 0 && (
                <div className="absolute bottom-0 left-0 w-full h-8 border-t border-zinc-100 pointer-events-none">
                    {measures.map((m, i) => {
                        // Measures are 4 beats (4/4 assumed for now)
                        const secondsPerMeasure = (4 * 60) / bpm;
                        const time = i * secondsPerMeasure;
                        const left = 10 + (i * MEASURE_WIDTH); // Matches VexFlow currentX start
                        return (
                            <div key={i} className="absolute top-0 flex flex-col items-start h-full" style={{ left: `${left}px` }}>
                                <div className="h-1.5 w-px bg-zinc-300"></div>
                                <span className="text-[9px] text-zinc-400 font-mono mt-0.5 -ml-2 select-none">
                                    {Math.floor(time / 60)}:{(time % 60).toFixed(0).padStart(2, '0')}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Playhead Cursor */}
            <div 
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none transition-all duration-75 ease-linear"
                style={{ 
                    left: `${cursorLeft}px`,
                    top: '20px',
                    height: '260px',
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
