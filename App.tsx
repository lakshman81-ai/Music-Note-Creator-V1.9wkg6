
import React, { useState, useRef, useEffect } from 'react';
import { NoteEvent, AudioState, HistoryEntry, LabelSettings } from './types';
import { PlayIcon, PauseIcon, UploadIcon, SettingsIcon, DownloadIcon, MusicIcon, HistoryIcon, TrashIcon, ActivityIcon, SegmentIcon, NextIcon, ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, LightBulbIcon, RefreshIcon, PianoIcon, SwatchIcon, StyleIcon } from './components/Icons';
import Equalizer from './components/Equalizer';
import SheetMusic from './components/SheetMusic';
import ConfidenceHeatmap from './components/ConfidenceHeatmap';
import SettingsModal from './components/SettingsModal';
import HistoryModal from './components/HistoryModal';
import SuggestionPopup from './components/SuggestionPopup';
import YouTubePlayer from './components/YouTubePlayer';
import { Toast, ToastType } from './components/Toast';
import { audioEngine } from './services/audioEngine';
import { HistoryService } from './services/historyService';
import { SuggestionService, SuggestedSettings } from './services/suggestionService';
import { AITranscription } from './services/aiTranscription';
import { RHYTHM_PATTERNS, STYLES, VOICES, GENRES } from './components/constants';

// --- Deterministic & Composition Engine ---

// Seeded random for consistent "YouTube" notes
const getSeededRandom = (seed: number) => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const generateDeterministicNotes = (videoId: string, startTime: number, endTime: number, keyboardSize: number = 61): { notes: NoteEvent[], bpm: number } => {
    const notes: NoteEvent[] = [];
    
    // 1. Initialize Base Seed from Video ID
    const baseSeed = videoId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    // Helper: Stateless random generator based on offsets from base seed
    const seededRandom = (offset: number) => getSeededRandom(baseSeed + offset);

    // 2. Global Musical Parameters (Deterministic)
    const BASE_BPM = 80;
    const BPM = BASE_BPM + Math.floor(seededRandom(0) * 30); 
    const BEAT_DURATION = 60 / BPM;
    const BAR_DURATION = BEAT_DURATION * 4; 

    // Scale Logic
    const isMinor = seededRandom(1) > 0.3;
    const rootBase = 60; 
    const rootNote = rootBase + Math.floor(seededRandom(2) * 12) - 6; 

    const scaleIntervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];

    // Helper: Get MIDI pitch constrained by keyboard size
    const getMidiPitch = (degree: number, octaveOffset: number) => {
        const len = scaleIntervals.length;
        const oct = Math.floor(degree / len);
        const idx = ((degree % len) + len) % len;
        let pitch = rootNote + (octaveOffset * 12) + (oct * 12) + scaleIntervals[idx];

        // Constraint Logic
        let minPitch = 36; // C2
        let maxPitch = 96; // C7

        if (keyboardSize === 37) { minPitch = 53; maxPitch = 89; } 
        else if (keyboardSize === 49) { minPitch = 36; maxPitch = 84; } 
        else if (keyboardSize === 54) { minPitch = 36; maxPitch = 89; } 
        else if (keyboardSize === 76) { minPitch = 28; maxPitch = 103; } 
        else if (keyboardSize === 88) { minPitch = 21; maxPitch = 108; } 

        while (pitch < minPitch) pitch += 12;
        while (pitch > maxPitch) pitch -= 12;

        return pitch;
    };

    const PROGRESSIONS = [
        [0, 5, 3, 4], // I vi IV V
        [0, 4, 5, 3], // I V vi IV
        [3, 4, 0, 0], // IV V I I
        [5, 3, 0, 4], // vi IV I V
    ];
    const progressionIdx = Math.floor(seededRandom(3) * PROGRESSIONS.length);
    const progression = PROGRESSIONS[progressionIdx];

    const startBar = Math.floor(startTime / BAR_DURATION);
    const endBar = Math.ceil(endTime / BAR_DURATION);

    for (let bar = startBar; bar < endBar; bar++) {
        const barStart = bar * BAR_DURATION;
        const chordDegree = progression[bar % 4];

        // Unique seed base for this bar to ensure independence from previous bars
        // offset range 1000+ avoids conflict with global params
        const barSeedBase = 1000 + (bar * 100); 

        // --- Layer A: Left Hand (Sustained Bass) ---
        const bassTime = Math.max(startTime, barStart);
        if (bassTime < endTime) {
             notes.push({
                id: `bass_${bar}_1`,
                start_time: barStart,
                duration: BAR_DURATION * 0.95, 
                midi_pitch: getMidiPitch(chordDegree, -2), 
                velocity: 0.7,
                confidence: 0.99
            });
        }

        // --- Layer B: Right Hand (Melody) ---
        // Iterate by 8th notes (0.5 beats)
        for (let beat = 0; beat < 4; beat += 0.5) {
            const noteTime = barStart + (beat * BEAT_DURATION);
            
            // Bounds check
            if (noteTime >= endTime) break;
            if (noteTime < startTime) continue;

            const noteSeed = barSeedBase + (beat * 10);
            const rPlay = seededRandom(noteSeed);

            // Rhythmic probability
            let shouldPlay = false;
            if (beat === 0) shouldPlay = true; // Always play on 1
            else if (beat % 1 === 0) shouldPlay = rPlay > 0.4; // Stronger on quarter beats
            else shouldPlay = rPlay > 0.75; // Sparse on off-beats

            if (shouldPlay) {
                const rDur = seededRandom(noteSeed + 1);
                let durationBeats = 0.5;
                if (rDur > 0.7) durationBeats = 1.0;
                else if (rDur > 0.9) durationBeats = 2.0;

                const rPitch = seededRandom(noteSeed + 2);
                let targetDegree = chordDegree;
                if (rPitch > 0.5) targetDegree += 2; // 3rd
                else if (rPitch > 0.8) targetDegree += 4; // 5th

                // Add melody contour variation
                const offset = Math.floor(seededRandom(noteSeed + 3) * 5) - 2; 

                const finalPitch = getMidiPitch(targetDegree + offset, 0);

                notes.push({
                    id: `mel_${bar}_${beat}`,
                    start_time: noteTime,
                    duration: durationBeats * BEAT_DURATION * 0.95, 
                    midi_pitch: finalPitch,
                    velocity: 0.7 + (seededRandom(noteSeed + 4) * 0.2),
                    confidence: 0.95
                });
            }
        }
    }

    return { notes: notes.sort((a,b) => a.start_time - b.start_time), bpm: BPM };
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
};

const generateThumbnail = (title: string): string => {
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="hsl(${hue}, 20%, 20%)" />
      <path d="M0,50 Q25,${40 + (hash % 20)} 50,50 T100,50" stroke="hsl(${hue}, 70%, 60%)" stroke-width="3" fill="none" opacity="0.8"/>
    </svg>
  `)}`;
};

const getYoutubeId = (urlStr: string) => {
    try {
        const url = new URL(urlStr);
        if (url.hostname === 'youtu.be') {
            return url.pathname.slice(1);
        }
        if (url.hostname.includes('youtube.com')) {
            const v = url.searchParams.get('v');
            if (v) return v;
            if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2];
            if (url.pathname.startsWith('/v/')) return url.pathname.split('/')[2];
        }
    } catch (e) {
        return null;
    }
    return null;
};

const App: React.FC = () => {
  // --- Refs ---
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sequencerRef = useRef<number | undefined>(undefined);
  const lastFrameTimeRef = useRef<number>(0);
  const playbackTimeRef = useRef<number>(0); // Track sequencer time independently of state
  const notesRef = useRef<NoteEvent[]>([]);
  const sequencerSpeedRef = useRef<number>(1.0);
  const audioBufferRef = useRef<AudioBuffer | null>(null); // Store decoded audio

  // --- Scroll Synchronization Refs ---
  const sheetMusicScrollRef = useRef<HTMLDivElement>(null);
  const heatmapScrollRef = useRef<HTMLDivElement>(null);

  const handleSheetMusicScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (heatmapScrollRef.current) {
        heatmapScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const handleHeatmapScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (sheetMusicScrollRef.current) {
        sheetMusicScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // --- State ---
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    sourceUrl: null,
    sourceType: 'youtube'
  });
  
  const [audioCrossOrigin, setAudioCrossOrigin] = useState<'anonymous' | undefined>('anonymous');
  
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isRestricted, setIsRestricted] = useState(false); 
  const [isSequencing, setIsSequencing] = useState(false);
  const [sequencerSpeed, setSequencerSpeed] = useState(1.0);
  
  const [ytUrl, setYtUrl] = useState('');
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
  const [labelSettings, setLabelSettings] = useState<LabelSettings>({
    showLabels: true,
    format: 'scientific',
    accidentalStyle: 'sharp',
    showOctave: true,
    showCentOffset: false,
    position: 'above',
    minConfidence: 0.4,
    keyboardSize: 61,
    selectedVoice: 'piano',
    selectedStyle: 'none'
  });

  const [compositionGenre, setCompositionGenre] = useState('Ballad');

  const [segmentDuration, setSegmentDuration] = useState<10 | 20 | 30>(10);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [processedSegments, setProcessedSegments] = useState<Set<number>>(new Set());
  const [segmentConfirmationOpen, setSegmentConfirmationOpen] = useState(false);

  // Rhythm State
  const [isRhythmPlaying, setIsRhythmPlaying] = useState(false);
  const [bpm, setBpm] = useState(80);

  // Suggestion State
  const [suggestedSettings, setSuggestedSettings] = useState<SuggestedSettings | null>(null);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { sequencerSpeedRef.current = sequencerSpeed; }, [sequencerSpeed]);

  // Audio Playback Synchronization Effect
  useEffect(() => {
    if (audioState.sourceType === 'file' && audioRef.current) {
        if (audioState.isPlaying) {
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    // AbortError is common when pausing rapidly or switching sources, ignore it
                    if (e.name !== 'AbortError') {
                        console.error("Playback failed:", e);
                        showToast("Playback failed", "error");
                        // Revert state if play failed significantly
                        setAudioState(p => ({...p, isPlaying: false}));
                    }
                });
            }
        } else {
            audioRef.current.pause();
        }
    }
  }, [audioState.isPlaying, audioState.sourceType]);

  // Handle Rhythm Playback
  useEffect(() => {
      const styleId = labelSettings.selectedStyle;
      if (isRhythmPlaying && styleId && styleId !== 'none') {
          const pattern = RHYTHM_PATTERNS[styleId];
          if (pattern) {
              audioEngine.startRhythm(pattern, bpm);
          } else {
             // Fallback or metronome
             audioEngine.stopRhythm();
          }
      } else {
          audioEngine.stopRhythm();
      }
      return () => audioEngine.stopRhythm();
  }, [isRhythmPlaying, labelSettings.selectedStyle, bpm]);

  const showToast = (message: string, type: ToastType) => {
    setToast({ message: type === 'loading' ? 'Loading...' : message, type });
    if (type === 'loading' && message) setToast({ message, type });
  };

  const stopSequencer = () => {
    if (sequencerRef.current) cancelAnimationFrame(sequencerRef.current);
    setIsSequencing(false);
    audioEngine.stopAllTones(); // Force silence active notes
  };

  const resetSession = () => {
      stopSequencer();
      audioEngine.stopAllTones();
      setNotes([]);
      setProcessedSegments(new Set());
      setCurrentSegmentIndex(0);
      setAudioState(prev => ({ ...prev, currentTime: 0, isPlaying: false, duration: 0 }));
      setSegmentConfirmationOpen(false);
      setIsPlayerReady(false); 
      setIsRestricted(false);
      setIsProcessing(false);
      audioBufferRef.current = null; // Clear buffer
      if (audioRef.current) audioRef.current.currentTime = 0;
      setSeekTarget(0);
  };

  // --- Logic: Analysis ---

  // Helper function to get notes for a specific range
  const fetchSegmentNotes = async (index: number, durationSec: number): Promise<{notes: NoteEvent[], bpm?: number}> => {
      const startTime = index * durationSec;
      const endTime = startTime + durationSec;
      let newNotes: NoteEvent[] = [];
      let detectedBpm: number | undefined;

      if (audioState.sourceType === 'file' && audioBufferRef.current) {
          // PRIMARY: GenAI Transcription
          try {
              const aiResult = await AITranscription.transcribeSegment(audioBufferRef.current, startTime, durationSec);
              // Apply Post-Processing from AudioEngine (Quantization & Cleanup) to AI notes
              newNotes = audioEngine.cleanupAndQuantize(aiResult.notes);
              detectedBpm = aiResult.bpm;
          } catch (aiError) {
              console.warn("AI Analysis unavailable, falling back to DSP Engine", aiError);
              // FALLBACK: DSP Engine
              newNotes = audioEngine.analyzeAudioSegment(audioBufferRef.current, startTime, durationSec);
          }
      } else if (audioState.sourceType === 'youtube' && ytVideoId) {
          // DETERMINISTIC COMPOSITION
          const result = generateDeterministicNotes(ytVideoId, startTime, endTime, labelSettings.keyboardSize);
          newNotes = result.notes;
          detectedBpm = result.bpm;
      }
      return { notes: newNotes, bpm: detectedBpm };
  };

  const analyzeSegment = async (index: number, totalDuration: number, force: boolean = false) => {
    if (!force && processedSegments.has(index)) return; 
    if (totalDuration === 0) return;

    if (audioState.sourceType === 'file' && !audioBufferRef.current) {
        showToast("Audio buffer missing. Please reload file.", "error");
        return;
    }

    setIsProcessing(true);
    showToast(`Analyzing segment ${index + 1}...`, 'loading');
    
    // Use timeout to allow UI update before heavy processing
    setTimeout(async () => {
        try {
            const { notes: newNotes, bpm: newBpm } = await fetchSegmentNotes(index, segmentDuration);
            
            if (newBpm) setBpm(newBpm);

            setNotes(prev => {
                let filteredPrev = prev;
                if (force) {
                   const startTime = index * segmentDuration;
                   const endTime = startTime + segmentDuration;
                   filteredPrev = prev.filter(n => n.start_time < startTime || n.start_time >= endTime);
                }
                const existingIds = new Set(filteredPrev.map(n => n.id));
                const filteredNew = newNotes.filter(n => !existingIds.has(n.id));
                return [...filteredPrev, ...filteredNew].sort((a, b) => a.start_time - b.start_time);
            });
            
            setProcessedSegments(prev => new Set(prev).add(index));
            setIsProcessing(false);
            showToast("Note Transcription Complete", 'success');

            const suggestions = SuggestionService.generateSuggestions(newNotes);
            if (suggestions) {
                setSuggestedSettings(suggestions);
                // setIsSuggestionOpen(true); // Disable automatic suggestion popup
            }
        } catch (e) {
            console.error(e);
            showToast("Analysis failed", "error");
            setIsProcessing(false);
        }
    }, 100);
  };

  const createHistoryEntry = (title: string, sourceType: 'file' | 'youtube', sourceUrl: string | null, duration: number) => {
    try {
        const newEntry: HistoryEntry = {
          id: generateId(),
          timestamp: new Date().toISOString(),
          title: title,
          source_type: sourceType,
          source_url: sourceUrl,
          audio_duration_sec: duration,
          notes_count: 0,
          avg_confidence: 0,
          bpm_detected: 120, // To be improved in future updates
          time_signature: "4/4",
          instrument_estimate: sourceType === 'youtube' ? "Composition" : "Audio Analysis",
          tags: ["segmented-analysis"],
          user_edits: { notes_modified: 0, notes_deleted: 0, notes_added: 0 },
          exports: { musicxml: false, midi: false, pdf: false, csv: false },
          thumbnail: generateThumbnail(title)
        };
        HistoryService.addEntry(newEntry);
    } catch (e) { console.warn("History error", e); }
  };

  // Auto-Analyze effect
  useEffect(() => {
      const isFileReady = audioState.sourceType === 'file' && !!audioBufferRef.current;
      const isYtReady = audioState.sourceType === 'youtube' && !!ytVideoId && (isPlayerReady || isRestricted);

      if (audioState.duration > 0 && !processedSegments.has(currentSegmentIndex)) {
          if (isFileReady || isYtReady) {
              analyzeSegment(currentSegmentIndex, audioState.duration, false);
          }
      }
  }, [audioState.duration, currentSegmentIndex, isPlayerReady, isRestricted, ytVideoId, audioState.sourceType]);


  // --- Handlers ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      showToast("Loading and decoding audio...", "loading");
      resetSession(); 
      
      try {
        // Decode audio data for analysis
        const buffer = await audioEngine.loadAudioFile(file);
        audioBufferRef.current = buffer;
        
        const url = URL.createObjectURL(file);
        
        // IMPORTANT: Set to undefined to allow AudioContext to access data from Blob URL
        setAudioCrossOrigin(undefined); 

        setAudioState(prev => ({ 
            ...prev, 
            sourceUrl: url, 
            sourceType: 'file',
            duration: buffer.duration
        }));
        setYtVideoId(null);
        
        setIsPlayerReady(true);
        showToast("Audio Loaded", "success");
        createHistoryEntry(file.name, 'file', null, buffer.duration);
      } catch (e) {
        console.error(e);
        showToast("Failed to decode audio file", "error");
      }
    }
  };

  const handleYoutubeLoad = () => {
    const id = getYoutubeId(ytUrl);
    if (!id) {
        showToast("Invalid YouTube URL", "error");
        return;
    }
    resetSession();
    showToast("Loading Music...", "loading");
    setYtVideoId(id);
    setAudioCrossOrigin('anonymous');
    setAudioState(prev => ({ ...prev, sourceType: 'youtube', sourceUrl: ytUrl }));
  };

  const onYoutubePlayerReady = (duration: number) => {
      setAudioState(prev => ({ ...prev, duration: duration }));
      setIsPlayerReady(true);
      showToast("Video Loaded", "success");
      createHistoryEntry(`YouTube Video (${ytVideoId})`, 'youtube', ytUrl, duration);
  };

  const handleYoutubeError = (error: { code: number, message: string }) => {
      if (error.code === 150 || error.code === 101 || error.code === 153) {
          setIsRestricted(true);
          showToast("Playback restricted. Generating notes only.", "info");
          setAudioState(prev => ({ ...prev, duration: prev.duration || 180 }));
          // Note: isPlayerReady remains FALSE for restricted videos, but we allow note generation
      } else {
          showToast(error.message, "error");
          setIsPlayerReady(false);
          setIsProcessing(false);
      }
  };

  const toggleSegmentSequencer = async () => {
    if (isSequencing) { stopSequencer(); return; }
    
    // Check if there are notes to play
    if (notesRef.current.length === 0) {
        showToast("No notes to play for this segment.", "info");
        return;
    }

    setAudioState(prev => ({ ...prev, isPlaying: false }));
    if (audioRef.current) audioRef.current.pause();
    
    // Ensure Audio Context is running before starting loop
    await audioEngine.ensureContext();
    audioEngine.resume();

    const start = currentSegmentIndex * segmentDuration;
    const end = start + segmentDuration;
    
    let currentTime = audioState.currentTime;
    if (currentTime < start || currentTime >= end - 0.5) {
        currentTime = start;
    }
    playbackTimeRef.current = currentTime;
    
    // Update UI immediately
    setAudioState(prev => ({ ...prev, currentTime }));

    setIsSequencing(true);
    lastFrameTimeRef.current = performance.now();

    const loop = (time: number) => {
        const dt = ((time - lastFrameTimeRef.current) / 1000) * sequencerSpeedRef.current;
        lastFrameTimeRef.current = time;

        const prevTime = playbackTimeRef.current;
        const newTime = prevTime + dt;
        playbackTimeRef.current = newTime;

        // Calculate notes to play (Moved outside state setter to prevent zombie notes)
        const notesToPlay = notesRef.current.filter(n => 
            n.start_time >= prevTime && n.start_time < newTime
        );
        
        // Play sound immediately
        notesToPlay.forEach(n => audioEngine.playTone(n.midi_pitch, n.duration, labelSettings.selectedVoice));

        // Optimize UI updates: Only update state if time changed significantly to save renders
        // But for smooth slider we might need frequent updates.
        setAudioState(prev => ({ ...prev, currentTime: newTime }));

        if (newTime >= end) {
            stopSequencer();
            setAudioState(prev => ({ ...prev, currentTime: start, isPlaying: false }));
            return;
        }
        sequencerRef.current = requestAnimationFrame(loop);
    };
    sequencerRef.current = requestAnimationFrame(loop);
  };

  const changeSequencerSpeed = (delta: number) => {
    setSequencerSpeed(prev => {
        const next = Math.max(0.25, Math.min(2.0, prev + delta));
        return parseFloat(next.toFixed(2));
    });
  };

  const togglePlay = async () => {
    if (isSequencing) stopSequencer();

    if (isRestricted) {
        showToast("Playback is disabled for this video (Copyright)", "error");
        return;
    }
    // If not ready and NOT file type (files become ready instantly), warn
    if (!isPlayerReady && audioState.sourceType !== 'file') {
        showToast("Please wait for music to load", "info");
        return;
    }
    if (isProcessing) {
        showToast("Please wait for note generation", "info");
        return;
    }

    const shouldPlay = !audioState.isPlaying;
    
    // Update state first - useEffect will handle the actual audio playback for files
    setAudioState(prev => ({ ...prev, isPlaying: shouldPlay }));

    if (audioState.sourceType === 'file' && shouldPlay) {
        try {
            // Critical: Resume AudioContext on user interaction
            await audioEngine.ensureContext();
            if (audioRef.current && audioRef.current.isConnected) {
                audioEngine.connectElement(audioRef.current);
            }
        } catch(e) {
            console.error("Audio Context Resume failed:", e);
        }
    }
  };

  const proceedToNextSegment = () => {
      setSegmentConfirmationOpen(false);
      stopSequencer();
      const nextIndex = currentSegmentIndex + 1;
      setCurrentSegmentIndex(nextIndex);
      if (!isRestricted) {
          setTimeout(() => setAudioState(prev => ({ ...prev, isPlaying: true })), 100);
      }
  };

  const handlePrevSegment = () => {
      stopSequencer();
      if (currentSegmentIndex > 0) {
          const newIndex = currentSegmentIndex - 1;
          setCurrentSegmentIndex(newIndex);
          const time = newIndex * segmentDuration;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (audioRef.current) audioRef.current.currentTime = time;
          if (audioState.sourceType === 'youtube') {
              setSeekTarget(time);
              setTimeout(() => setSeekTarget(null), 100);
          }
      }
  };

  const handleNextSegment = () => {
      stopSequencer();
      const maxIndex = Math.floor((audioState.duration || 0) / segmentDuration);
      if (currentSegmentIndex < maxIndex) {
          const newIndex = currentSegmentIndex + 1;
          setCurrentSegmentIndex(newIndex);
          const time = newIndex * segmentDuration;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (audioRef.current) audioRef.current.currentTime = time;
          if (audioState.sourceType === 'youtube') {
            setSeekTarget(time);
            setTimeout(() => setSeekTarget(null), 100);
          }
      }
  };

  const checkSegmentBoundary = (time: number) => {
    if (isSequencing) return;
    const segmentIndex = Math.floor(time / segmentDuration);
    if (segmentIndex > currentSegmentIndex) {
        setAudioState(prev => ({ ...prev, isPlaying: false }));
        if (audioState.sourceType === 'file' && audioRef.current) audioRef.current.pause();
        const boundaryTime = segmentIndex * segmentDuration;
        setAudioState(prev => ({ ...prev, currentTime: boundaryTime }));
        if (audioRef.current) audioRef.current.currentTime = boundaryTime;
        setSeekTarget(boundaryTime);
        setSegmentConfirmationOpen(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopSequencer();
    const time = parseFloat(e.target.value);
    playbackTimeRef.current = time;
    setAudioState(prev => ({ ...prev, currentTime: time }));
    setSegmentConfirmationOpen(false);
    const newSegmentIndex = Math.floor(time / segmentDuration);
    setCurrentSegmentIndex(newSegmentIndex);
    
    if (audioState.sourceType === 'file' && audioRef.current) {
        audioRef.current.currentTime = time;
    } else if (audioState.sourceType === 'youtube' && !isRestricted) {
        setSeekTarget(time);
        setTimeout(() => setSeekTarget(null), 100);
    }
  };

  const handleNativeTimeUpdate = () => {
    if (audioRef.current && !isSequencing) {
      const time = audioRef.current.currentTime;
      setAudioState(prev => ({ ...prev, currentTime: time }));
      checkSegmentBoundary(time);
    }
  };

  const handleYoutubeTimeUpdate = (time: number) => {
      if (!isSequencing) {
          setAudioState(prev => ({ ...prev, currentTime: time }));
          checkSegmentBoundary(time);
      }
  };

  const handleNoteClick = async (noteId: string) => {
    setSelectedNoteId(noteId);
    const note = notes.find(n => n.id === noteId);
    if (note) {
        // Ensure context is running when clicking notes manually
        await audioEngine.ensureContext();
        audioEngine.playTone(note.midi_pitch, note.duration, labelSettings.selectedVoice);
    }
  };

  const handleAcceptSuggestion = () => {
    if (suggestedSettings) {
      setLabelSettings(prev => ({
        ...prev,
        selectedVoice: suggestedSettings.voice,
        selectedStyle: suggestedSettings.style,
      }));
      setBpm(suggestedSettings.bpm);
      showToast("Settings applied", "success");
    }
    setIsSuggestionOpen(false);
  };

  const handleRejectSuggestion = () => {
    setIsSuggestionOpen(false);
  };

  const handleSuggestSettings = () => {
    const suggestions = SuggestionService.generateSuggestions(notes);
    if (suggestions) {
      setSuggestedSettings(suggestions);
      setIsSuggestionOpen(true);
    } else {
      showToast("Not enough data for a suggestion", "info");
    }
  };

  const handleRegenerate = () => {
    // Clear from processed set to allow re-analysis
    setProcessedSegments(prev => {
        const next = new Set(prev);
        next.delete(currentSegmentIndex);
        return next;
    });
    // Trigger analysis with force=true
    analyzeSegment(currentSegmentIndex, audioState.duration, true);
  };

  const handleReviewSegment = () => {
      setSegmentConfirmationOpen(false);
      const startTime = currentSegmentIndex * segmentDuration;
      
      setAudioState(prev => ({ ...prev, currentTime: startTime, isPlaying: true }));
      
      if (audioState.sourceType === 'file' && audioRef.current) {
          audioRef.current.currentTime = startTime;
          // Ensure context
          audioEngine.ensureContext().then(() => {
             if (audioRef.current && audioRef.current.isConnected) {
                 audioRef.current.play().catch(e => {
                    if (e.name !== 'AbortError') {
                        console.error("Playback failed", e);
                        showToast("Playback failed", "error");
                    }
                 });
             }
          });
      } else if (audioState.sourceType === 'youtube') {
          setSeekTarget(startTime);
          setTimeout(() => setSeekTarget(null), 100);
      }
  };

  // Check if player is strictly enabled
  const isPlayDisabled = 
    isProcessing || 
    (audioState.sourceType === 'file' && !audioState.sourceUrl) || // Strict file check
    (!isPlayerReady && audioState.sourceType !== 'file' && !isRestricted);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col font-sans selection:bg-indigo-500/30">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <SettingsModal 
        isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} 
        labelSettings={labelSettings} onLabelSettingsChange={setLabelSettings}
      />
      
      <HistoryModal 
        isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onLoadEntry={() => {}}
      />

      <SuggestionPopup
        isOpen={isSuggestionOpen}
        settings={suggestedSettings}
        onAccept={handleAcceptSuggestion}
        onReject={handleRejectSuggestion}
      />

      {segmentConfirmationOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-900 border border-zinc-700 p-8 rounded-2xl shadow-2xl max-w-md w-full text-center">
                  <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <SegmentIcon className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Segment Complete</h2>
                  <p className="text-zinc-400 mb-6">You have reached the end of the {segmentDuration}-second segment. Proceed?</p>
                  <div className="flex gap-3 justify-center">
                      <button 
                        onClick={handleReviewSegment}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full transition-colors flex items-center gap-2"
                      >
                          <ChevronLeftIcon className="w-4 h-4" /> Review
                      </button>
                      <button 
                        onClick={proceedToNextSegment}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-full shadow-lg flex items-center gap-2"
                      >
                          Proceed <NextIcon className="w-4 h-4" />
                      </button>
                  </div>
              </div>
          </div>
      )}

      <audio 
        ref={audioRef} 
        // KEY REMOVED: To prevent unmounting on state updates which causes 'media removed from document' error
        src={audioState.sourceType === 'file' ? audioState.sourceUrl || undefined : undefined}
        crossOrigin={audioCrossOrigin}
        onTimeUpdate={handleNativeTimeUpdate}
        onEnded={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
        onPlay={() => setAudioState(prev => ({ ...prev, isPlaying: true }))}
        onPause={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onError={(e) => {
            if (audioState.sourceType === 'file') {
                console.error("Audio playback error", e);
                showToast("Audio playback error", "error");
            }
        }}
        className="hidden"
      />

      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <MusicIcon className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-white">Music Note Creator</h1>
          </div>
          <div className="flex items-center gap-3">
             <button title="Toggle Note Labels" onClick={() => setLabelSettings(s => ({ ...s, showLabels: !s.showLabels }))} className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors text-sm font-medium border ${labelSettings.showLabels ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'}`}>
                <span className="font-bold font-serif italic">ABC</span>
             </button>
            <button title="Project History" onClick={() => setIsHistoryOpen(true)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 rounded-full hover:bg-zinc-700 transition-colors">
              <HistoryIcon className="w-5 h-5" />
            </button>
            <button title="Settings" onClick={() => setIsSettingsOpen(true)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 rounded-full hover:bg-zinc-700 transition-colors">
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Sidebar: Controls */}
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Audio Source */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Audio Source</h2>
            
            <div className="flex p-1 bg-zinc-950 rounded-full mb-4">
              <button 
                title="Use YouTube Source"
                className={`flex-1 py-1.5 text-sm rounded-full font-medium transition-all ${audioState.sourceType === 'youtube' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setAudioState(prev => ({ ...prev, sourceType: 'youtube' }))}
              >
                YouTube
              </button>
              <button 
                title="Upload Audio File"
                className={`flex-1 py-1.5 text-sm rounded-full font-medium transition-all ${audioState.sourceType === 'file' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setAudioState(prev => ({ ...prev, sourceType: 'file' }))}
              >
                Upload
              </button>
            </div>

            {audioState.sourceType === 'youtube' ? (
              <div className="space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Paste YouTube URL..." 
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 text-white"
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                    />
                    <button 
                        onClick={handleYoutubeLoad}
                        disabled={isProcessing}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg transition-colors"
                        title="Load Video"
                    >
                        {isProcessing || (!isPlayerReady && ytVideoId && !isRestricted) ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <DownloadIcon className="w-4 h-4" />}
                    </button>
                  </div>
              </div>
            ) : (
              <div title="Click to upload audio file" onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-zinc-700 hover:border-indigo-500 hover:bg-zinc-800/50 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all group mb-4">
                <UploadIcon className="w-8 h-8 text-zinc-500 group-hover:text-indigo-400 mb-2" />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-200">Upload File</span>
                <input type="file" ref={fileInputRef} className="hidden" accept="audio/*,.mp3,.mpeg,.wav,.m4a" onChange={handleFileUpload} />
              </div>
            )}

            <div className="border-t border-zinc-800 pt-4 mt-4 flex flex-col gap-4">
                <div className="w-full flex flex-col gap-1 group">
                    <input 
                        type="range" min="0" max={audioState.duration || 1} step="0.1"
                        value={audioState.currentTime}
                        onChange={handleSeek}
                        className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-zinc-500 font-mono group-hover:text-zinc-400">
                        <span>{Math.floor(audioState.currentTime / 60)}:{(Math.floor(audioState.currentTime) % 60).toString().padStart(2, '0')}</span>
                        <span>{Math.floor(audioState.duration / 60)}:{(Math.floor(audioState.duration) % 60).toString().padStart(2, '0')}</span>
                    </div>
                </div>
                
                <div className="flex items-center justify-between">
                    <button 
                        onClick={togglePlay}
                        disabled={isPlayDisabled}
                        className="flex items-center gap-2 bg-zinc-100 hover:bg-white text-black px-4 py-2 rounded-full font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {audioState.isPlaying && !isSequencing ? <PauseIcon className="w-4 h-4 fill-current" /> : <PlayIcon className="w-4 h-4 fill-current" />}
                        {audioState.isPlaying && !isSequencing ? "Pause Audio" : "Play Audio"}
                    </button>
                    {isBuffering && <span className="text-xs text-indigo-400 animate-pulse">Buffering...</span>}
                </div>
            </div>
          </div>

          {/* Control & Analysis Panel */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-0 overflow-hidden shadow-sm flex flex-col">
             
             {/* Header */}
             <div className="flex justify-between items-center p-4 pb-2 border-b border-zinc-800/50">
                 <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Controls & Analysis</h2>
                 <span className="text-[10px] bg-indigo-900/30 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/20">AI Enhanced</span>
             </div>

             <div className="p-4 space-y-4">
                 
                 {/* Row 1: Segment Controls */}
                 <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-1.5 flex items-center justify-between">
                     {/* Left Arrow */}
                     <button onClick={handlePrevSegment} disabled={currentSegmentIndex === 0} className="p-1.5 text-zinc-500 hover:text-white disabled:opacity-30 rounded-full hover:bg-zinc-800 transition-colors">
                        <ChevronLeftIcon className="w-5 h-5" />
                     </button>
                     
                     {/* Text */}
                     <div className="flex flex-col items-center">
                          <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest leading-tight">Segment</span>
                          <div className="flex items-center gap-2 text-sm font-mono text-zinc-300 font-bold">
                             <span className="text-indigo-400 text-base">{currentSegmentIndex + 1}</span>
                             <span className="text-zinc-600">/</span>
                             <span className="text-base">{Math.max(1, Math.ceil((audioState.duration || 1)/segmentDuration))}</span>
                          </div>
                     </div>

                     {/* Right Arrow */}
                     <button onClick={handleNextSegment} className="p-1.5 text-zinc-500 hover:text-white rounded-full hover:bg-zinc-800 transition-colors">
                        <ChevronRightIcon className="w-5 h-5" />
                     </button>

                     {/* Separator */}
                     <div className="h-8 w-px bg-zinc-800 mx-2"></div>

                     {/* Duration Dropdown */}
                     <div className="relative min-w-[110px]">
                          <select 
                             value={segmentDuration}
                             onChange={(e) => {
                                 setSegmentDuration(Number(e.target.value) as any);
                                 setCurrentSegmentIndex(0);
                                 setProcessedSegments(new Set());
                             }}
                             className="w-full bg-transparent text-sm text-zinc-200 font-medium appearance-none focus:outline-none cursor-pointer text-right pr-4"
                          >
                              <option value="10">10s Segments</option>
                              <option value="20">20s Segments</option>
                              <option value="30">30s Segments</option>
                          </select>
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500 text-[10px]">▼</div>
                     </div>
                 </div>

                 {/* Row 2: Voice | Style | BPM */}
                 <div className="flex gap-2">
                     {/* Voice */}
                     <div className="flex-[2] bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col px-3 py-1.5 relative group hover:border-zinc-700 transition-colors min-w-0">
                         <div className="flex items-center gap-1.5 mb-0.5">
                            <PianoIcon className="w-3 h-3 text-zinc-500" />
                            <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Voice</label>
                         </div>
                         <select 
                             value={labelSettings.selectedVoice}
                             onChange={(e) => setLabelSettings(s => ({ ...s, selectedVoice: e.target.value }))}
                             className="bg-transparent text-xs text-white font-medium appearance-none w-full focus:outline-none cursor-pointer truncate"
                         >
                             {VOICES.map(v => <option key={v.id} value={v.id} className="bg-zinc-900">{v.name}</option>)}
                         </select>
                     </div>

                     {/* Style */}
                     <div className="flex-[2] bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col px-3 py-1.5 relative group hover:border-zinc-700 transition-colors min-w-0">
                         <div className="flex items-center gap-1.5 mb-0.5">
                            <SwatchIcon className="w-3 h-3 text-zinc-500" />
                            <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Style</label>
                         </div>
                         <select 
                             value={compositionGenre}
                             onChange={(e) => setCompositionGenre(e.target.value)}
                             className="bg-transparent text-xs text-white font-medium appearance-none w-full focus:outline-none cursor-pointer truncate"
                         >
                             {GENRES.map(g => <option key={g} value={g} className="bg-zinc-900">{g}</option>)}
                         </select>
                     </div>

                     {/* BPM */}
                     <div className="w-[60px] bg-zinc-950 border border-zinc-800 rounded-xl flex flex-col px-2 py-1.5 relative group hover:border-zinc-700 transition-colors shrink-0">
                          <label className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mb-0.5">BPM</label>
                          <input 
                             type="number" 
                             value={bpm}
                             onChange={(e) => setBpm(Number(e.target.value))}
                             className="bg-transparent text-xs text-white font-medium w-full focus:outline-none font-mono"
                          />
                     </div>
                 </div>

                 {/* Row 3: Rhythm */}
                 <div className="flex gap-2">
                      <div className="flex-[3] bg-zinc-950 border border-zinc-800 rounded-xl flex items-center px-3 py-2 relative group hover:border-zinc-700 transition-colors min-w-0">
                         <select 
                             value={labelSettings.selectedStyle}
                             onChange={(e) => setLabelSettings(s => ({ ...s, selectedStyle: e.target.value }))}
                             className="bg-transparent text-xs text-zinc-300 w-full focus:outline-none appearance-none cursor-pointer truncate"
                         >
                             {STYLES.map(s => <option key={s.id} value={s.id} className="bg-zinc-900">{s.name}</option>)}
                         </select>
                         <div className="absolute right-3 pointer-events-none text-zinc-600 text-[10px]">▼</div>
                      </div>
                      <button 
                         onClick={() => setIsRhythmPlaying(!isRhythmPlaying)}
                         className={`flex-1 px-3 py-2 text-xs font-bold rounded-full border transition-all whitespace-nowrap ${isRhythmPlaying ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-300' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}
                      >
                          {isRhythmPlaying ? 'Stop' : 'Play Rhythm'}
                      </button>
                 </div>

             </div>

             {/* Row 4: Bottom Actions Bar */}
             <div className="mt-auto border-t border-zinc-800 flex items-center justify-between p-3 gap-3">
                {/* Suggest */}
                <button 
                    onClick={handleSuggestSettings}
                    className="flex-[1] h-9 rounded-full flex items-center justify-center gap-2 text-zinc-400 hover:text-yellow-400 hover:bg-zinc-800/50 transition-colors text-xs font-bold uppercase tracking-wide group"
                >
                     <LightBulbIcon className="w-4 h-4 group-hover:text-yellow-400 transition-colors text-yellow-600/70" />
                     Suggest
                </button>

                {/* Play Sequence (Main) */}
                <button 
                    onClick={toggleSegmentSequencer}
                    disabled={isProcessing || !processedSegments.has(currentSegmentIndex)}
                    className="flex-[2] h-10 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center gap-2 text-sm font-bold shadow-lg transition-all transform active:scale-95"
                >
                     {isSequencing ? <PauseIcon className="w-4 h-4 fill-current" /> : <PlayIcon className="w-4 h-4 fill-current" />}
                     {isSequencing ? "Stop Sequence" : "Play Sequence"}
                </button>

                {/* Regenerate */}
                <button 
                    onClick={handleRegenerate}
                    className="flex-[1] h-9 rounded-full flex items-center justify-center gap-2 text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors text-xs font-bold uppercase tracking-wide"
                >
                     <RefreshIcon className="w-4 h-4" />
                     Regenerate
                </button>
             </div>

          </div>

        </section>

        {/* Right Content: Editors & Visuals */}
        <section className="lg:col-span-8 flex flex-col gap-4 relative">
            
            {/* Note Editor */}
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-zinc-200 relative">
                <SheetMusic 
                    notes={notes}
                    currentTime={audioState.currentTime}
                    totalDuration={audioState.duration}
                    bpm={bpm}
                    onNoteClick={handleNoteClick}
                    selectedNoteId={selectedNoteId}
                    labelSettings={labelSettings}
                    scrollRef={sheetMusicScrollRef}
                    onScroll={handleSheetMusicScroll}
                />
            </div>

            {/* Analysis Graph */}
            <div className="rounded-2xl overflow-hidden shadow-lg border border-zinc-800 bg-zinc-900">
                <ConfidenceHeatmap 
                    notes={notes} 
                    currentTime={audioState.currentTime}
                    totalDuration={audioState.duration}
                    scrollRef={heatmapScrollRef}
                    onScroll={handleHeatmapScroll}
                />
            </div>

            {/* Visualizer */}
            <div className="h-32 mt-auto">
                <Equalizer isPlaying={audioState.isPlaying || isSequencing} />
            </div>

            {/* Youtube Player Hidden Overlay */}
            {audioState.sourceType === 'youtube' && ytVideoId && (
                <div className="fixed bottom-6 left-6 w-48 h-28 rounded-xl overflow-hidden shadow-2xl border border-zinc-700 z-50 opacity-90 hover:opacity-100 transition-opacity">
                    <YouTubePlayer 
                        videoId={ytVideoId}
                        isPlaying={audioState.isPlaying && !isSequencing}
                        onReady={onYoutubePlayerReady}
                        onStateChange={(isPlaying) => setAudioState(p => ({...p, isPlaying}))}
                        onTimeUpdate={handleYoutubeTimeUpdate}
                        seekTo={seekTarget}
                        onError={handleYoutubeError}
                    />
                </div>
            )}

        </section>

      </main>
    </div>
  );
};

export default App;
