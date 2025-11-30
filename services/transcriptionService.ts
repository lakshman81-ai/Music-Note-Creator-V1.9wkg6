export const TranscriptionService = {
  transcribeAudio: async (audioBlob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('file', audioBlob, 'input.mp3');

    // In a real setup, this URL would be configurable
    const API_URL = 'http://localhost:8000/api/transcribe';

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const musicXML = await response.text();
      return musicXML;
    } catch (error) {
      console.error("Transcription failed:", error);
      throw error;
    }
  }
};
