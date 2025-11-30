

export const PIXELS_PER_SECOND = 80;

export const VOICES = [
    { id: 'piano', name: 'Grand Piano', category: 'Piano' },
    { id: 'bright_piano', name: 'Bright Piano', category: 'Piano' },
    { id: 'elec_piano', name: 'Electric Piano', category: 'Piano' },
    { id: 'harmonium_1', name: 'Harmonium 1', category: 'Indian' },
    { id: 'harmonium_2', name: 'Harmonium 2', category: 'Indian' },
    { id: 'sitar', name: 'Sitar', category: 'Indian' },
    { id: 'veena', name: 'Veena', category: 'Indian' },
    { id: 'shenai', name: 'Shehnai', category: 'Indian' },
    { id: 'sarod', name: 'Sarod', category: 'Indian' },
    { id: 'santur', name: 'Santur', category: 'Indian' },
    { id: 'tabla_voice', name: 'Tabla (Pitch)', category: 'Indian' },
    { id: 'bansuri', name: 'Bansuri', category: 'Indian' },
    { id: 'violin', name: 'Violin', category: 'Strings' },
    { id: 'strings', name: 'String Ensemble', category: 'Strings' },
    { id: 'guitar_nylon', name: 'Guitar (Nylon)', category: 'Guitar' },
    { id: 'guitar_steel', name: 'Guitar (Steel)', category: 'Guitar' },
    { id: 'synth_lead', name: 'Synth Lead', category: 'Synth' },
    { id: 'synth_pad', name: 'Synth Pad', category: 'Synth' }
];

export const STYLES = [
    { id: 'none', name: 'No Rhythm (Metronome)', timeSignature: '4/4' },
    { id: 'teen_taal', name: 'Teen Taal (16 Beats)', timeSignature: '16/4' },
    { id: 'dadra', name: 'Dadra (6 Beats)', timeSignature: '6/8' },
    { id: 'keherwa', name: 'Keherwa (8 Beats)', timeSignature: '4/4' },
    { id: 'rupak', name: 'Rupak (7 Beats)', timeSignature: '7/4' },
    { id: 'bhajan', name: 'Bhajan', timeSignature: '8/4' },
    { id: 'garba', name: 'Garba', timeSignature: '6/8' },
    { id: 'dandiya', name: 'Dandiya', timeSignature: '4/4' },
    { id: 'bhangra', name: 'Bhangra', timeSignature: '4/4' },
    { id: 'pop_8beat', name: 'Pop 8 Beat', timeSignature: '4/4' },
    { id: 'rock_standard', name: 'Rock Standard', timeSignature: '4/4' },
    { id: 'disco', name: 'Disco', timeSignature: '4/4' },
    { id: 'swing', name: 'Swing', timeSignature: '4/4' },
    { id: 'waltz', name: 'Waltz', timeSignature: '3/4' }
];

export const GENRES = [
    'Ballad',
    'Pop',
    'Rock',
    'Jazz',
    'Classical',
    'Electronic',
    'Ambient'
];

export interface RhythmPattern {
    length: number; // in beats
    steps: {
        beat: number; // 0-based
        sound: 'kick' | 'snare' | 'hihat_closed' | 'hihat_open' | 'tabla_dha' | 'tabla_tin' | 'tabla_na' | 'tabla_ge' | 'tabla_ke';
        velocity: number;
    }[];
}

export const RHYTHM_PATTERNS: Record<string, RhythmPattern> = {
    'teen_taal': {
        length: 16,
        steps: [
            { beat: 0, sound: 'tabla_dha', velocity: 1.0 }, // Dha
            { beat: 1, sound: 'tabla_dha', velocity: 0.8 }, // Dhin
            { beat: 2, sound: 'tabla_dha', velocity: 0.8 }, // Dhin
            { beat: 3, sound: 'tabla_dha', velocity: 1.0 }, // Dha
            { beat: 4, sound: 'tabla_dha', velocity: 1.0 }, // Dha
            { beat: 5, sound: 'tabla_dha', velocity: 0.8 }, // Dhin
            { beat: 6, sound: 'tabla_dha', velocity: 0.8 }, // Dhin
            { beat: 7, sound: 'tabla_dha', velocity: 1.0 }, // Dha
            { beat: 8, sound: 'tabla_dha', velocity: 1.0 }, // Dha
            { beat: 9, sound: 'tabla_tin', velocity: 0.8 }, // Tin
            { beat: 10, sound: 'tabla_tin', velocity: 0.8 }, // Tin
            { beat: 11, sound: 'tabla_na', velocity: 0.9 }, // Na
            { beat: 12, sound: 'tabla_na', velocity: 0.9 }, // Ta
            { beat: 13, sound: 'tabla_dha', velocity: 0.8 }, // Dhin
            { beat: 14, sound: 'tabla_dha', velocity: 0.8 }, // Dhin
            { beat: 15, sound: 'tabla_dha', velocity: 1.0 }, // Dha
        ]
    },
    'dadra': {
        length: 6,
        steps: [
            { beat: 0, sound: 'tabla_dha', velocity: 1.0 },
            { beat: 1, sound: 'tabla_dha', velocity: 0.7 }, // Dhin
            { beat: 2, sound: 'tabla_na', velocity: 0.8 },
            { beat: 3, sound: 'tabla_dha', velocity: 1.0 },
            { beat: 4, sound: 'tabla_tin', velocity: 0.7 },
            { beat: 5, sound: 'tabla_na', velocity: 0.8 },
        ]
    },
    'keherwa': {
        length: 8,
        steps: [
            { beat: 0, sound: 'tabla_dha', velocity: 1.0 },
            { beat: 1, sound: 'tabla_ge', velocity: 0.7 },
            { beat: 2, sound: 'tabla_na', velocity: 0.8 },
            { beat: 3, sound: 'tabla_tin', velocity: 0.7 },
            { beat: 4, sound: 'tabla_na', velocity: 0.8 },
            { beat: 5, sound: 'tabla_ke', velocity: 0.6 },
            { beat: 6, sound: 'tabla_dha', velocity: 0.9 },
            { beat: 7, sound: 'tabla_ge', velocity: 0.7 },
        ]
    },
    'pop_8beat': {
        length: 4,
        steps: [
            { beat: 0, sound: 'kick', velocity: 1.0 },
            { beat: 0.5, sound: 'hihat_closed', velocity: 0.6 },
            { beat: 1, sound: 'snare', velocity: 0.9 },
            { beat: 1.5, sound: 'hihat_closed', velocity: 0.6 },
            { beat: 2, sound: 'kick', velocity: 1.0 },
            { beat: 2.5, sound: 'hihat_closed', velocity: 0.6 },
            { beat: 3, sound: 'snare', velocity: 0.9 },
            { beat: 3.5, sound: 'hihat_open', velocity: 0.7 },
        ]
    }
};
