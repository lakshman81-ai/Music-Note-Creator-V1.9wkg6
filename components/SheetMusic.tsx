
import React, { useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { TranscriptionService } from '../services/transcriptionService';

interface SheetMusicProps {
  musicXML?: string; // Content string
  currentTime?: number;
  bpm?: number;
}

const SheetMusic: React.FC<SheetMusicProps> = ({ 
    musicXML, currentTime, bpm
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Constants
  const BASE_MEASURE_WIDTH = 220; // Recommended minimum
  const STAFF_SPACE = 10;
  
  // Memoize measures for rendering efficiency and to use in axis generation
  const { measures, diagnostics } = useMemo(() => {
      const result = MusicNotationService.processNotes(notes, bpm);
      return result;
  }, [notes, bpm]);

  // Logic: Sync scroll to playhead
  useEffect(() => {
    if (!containerRef.current) return;

    // Cleanup previous instance
    if (osmdRef.current) {
        osmdRef.current.clear();
    }

    // Create new instance
    // autoResize: true allows it to fit the container
    // backend: 'svg' is preferred for crisp rendering
    const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        backend: 'svg',
        drawingParameters: 'compacttight', // optimizes space
        drawTitle: true,
        drawSubtitle: true,
        drawComposer: true,
        drawCredits: false,
    });

    osmdRef.current = osmd;
    setIsReady(true);

    return () => {
        // Cleanup if component unmounts
        // osmdRef.current?.clear();
        // OSMD doesn't have a strict 'destroy' but clearing helps.
    };
  }, []);

  // Load XML when available
  useEffect(() => {
      if (isReady && osmdRef.current && musicXML) {
          const loadScore = async () => {
              try {
                  await osmdRef.current!.load(musicXML);
                  osmdRef.current!.render();

                  // Reset cursor
                  osmdRef.current!.cursor.show();
                  osmdRef.current!.cursor.reset();
              } catch (e) {
                  console.error("OSMD Load Error:", e);
              }
          };
          loadScore();
      }
  }, [isReady, musicXML]);

  // Sync Cursor logic (Basic implementation)
  // OSMD Cursor is note-based, not time-based continuous.
  // We need to map currentTime to the approximate note index or measure.
  // This is complex because OSMD doesn't expose strict "time-to-cursor" easily without a full playback engine.
  // For now, we will leave the visual cursor static or implement a basic "next" stepping if we had note events.
  // Since we are shifting to backend-generated XML, the frontend loses the granular "NoteEvent[]" state unless we re-parse XML.
  //
  // *Strategic decision:*
  // For this verification step, we will verify rendering.
  // Detailed playback cursor synchronization with OSMD requires listening to OSMD's internal iterator.

  return (
    <div className="w-full h-full min-h-[400px] overflow-auto bg-white rounded-xl shadow-sm p-4">
        <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

export default SheetMusic;
