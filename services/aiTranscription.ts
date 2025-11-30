import { GoogleGenAI, Schema, Type } from "@google/genai";
import { NoteEvent } from '../types';
import { audioBufferToWav, blobToBase64 } from '../utils/audioExport';

// Lazy initialization to prevent crash if env var is missing at module load time
let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return aiInstance;
};

const noteSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    notes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start_time: { type: Type.NUMBER, description: "Start time of the note in seconds relative to the audio segment start." },
          duration: { type: Type.NUMBER, description: "Duration of the note in seconds." },
          midi_pitch: { type: Type.NUMBER, description: "MIDI pitch number (21-108)." },
          velocity: { type: Type.NUMBER, description: "Velocity or volume (0.0 to 1.0)." },
          confidence: { type: Type.NUMBER, description: "Confidence score (0.0 to 1.0)." }
        },
        required: ["start_time", "duration", "midi_pitch"]
      }
    },
    key: { type: Type.STRING, description: "Detected key of the segment (e.g., C Major)." },
    bpm: { type: Type.NUMBER, description: "Detected tempo in BPM." }
  }
};

export const AITranscription = {
  transcribeSegment: async (audioBuffer: AudioBuffer, startTime: number, duration: number): Promise<{ notes: NoteEvent[], key?: string, bpm?: number }> => {
    try {
      // 1. Prepare Audio
      const wavBlob = audioBufferToWav(audioBuffer, startTime, duration);
      const base64Audio = await blobToBase64(wavBlob);

      // 2. Call Gemini
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: base64Audio
            }
          },
          {
            text: `Analyze the audio clip from start to finish (duration: ${duration}s). 
            Transcribe the full musical arrangement including **melody and harmony (chords)**.
            - Detect simultaneous notes (Polyphony).
            - Capture the richness of the music, not just the top line.
            - Ignore drums/percussion.
            - Be extremely precise with timing (start_time).
            - Ensure the full duration is covered.
            Return JSON.`
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: noteSchema,
          temperature: 0.1 // Lower temperature for more consistent, factual extraction
        }
      });

      // 3. Parse Result
      const json = JSON.parse(response.text || "{}");
      
      if (!json.notes || !Array.isArray(json.notes)) {
        // Fallback for empty responses
        return { notes: [], key: undefined, bpm: undefined };
      }

      const notes: NoteEvent[] = json.notes.map((n: any, i: number) => ({
        id: `ai_${startTime}_${i}`,
        start_time: startTime + (n.start_time || 0),
        duration: Math.max(0.1, n.duration || 0.2),
        midi_pitch: n.midi_pitch || 60,
        velocity: n.velocity || 0.8,
        confidence: n.confidence || 0.95
      }));

      return { 
        notes, 
        key: json.key, 
        bpm: json.bpm 
      };

    } catch (error) {
      console.error("AI Transcription failed:", error);
      throw error;
    }
  }
};