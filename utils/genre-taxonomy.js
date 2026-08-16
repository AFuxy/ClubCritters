/**
 * CLUB FuRN - GENRE TAXONOMY & NORMALIZATION UTILITY
 * Standardized electronic & club music taxonomy with parent category mapping.
 */

const GENRE_TAXONOMY = {
    'Drum & Bass': {
        slug: 'dnb',
        aliases: [
            'dnb', 'd&b', 'drum & bass', 'drum and bass', 'drum n bass', 'drum&bass',
            'liquid', 'liquid dnb', 'liquid drum and bass', 'neurofunk', 'neuro',
            'jump up', 'jump-up', 'jumpup', 'jungle', 'ragga jungle', 'halftime',
            'dancefloor dnb', 'drumfunk', 'techstep', 'darkstep', 'deep dnb', 'roller'
        ]
    },
    'Trance': {
        slug: 'trance',
        aliases: [
            'trance', 'melodic trance', 'psytrance', 'psy trance', 'psy-trance',
            'uplifting trance', 'uplifting', 'tech trance', 'tech-trance', 'vocal trance',
            'progressive trance', 'prog trance', 'goa', 'goa trance', 'hard trance',
            'euro trance', 'eurotrance', 'acid trance', '138', '140 trance', 'classic trance'
        ]
    },
    'House': {
        slug: 'house',
        aliases: [
            'house', 'tech house', 'tech-house', 'deep house', 'bass house',
            'progressive house', 'prog house', 'electro house', 'future house',
            'acid house', 'funky house', 'afro house', 'melodic house', 'french house',
            'speed house', 'jackin house', 'disco house', 'tribal house', 'g-house',
            'slap house', 'tropical house', 'latin house', 'chicago house'
        ]
    },
    'Techno': {
        slug: 'techno',
        aliases: [
            'techno', 'hard techno', 'hardtechno', 'peak time techno', 'melodic techno',
            'industrial techno', 'raw techno', 'dark techno', 'acid techno', 'minimal techno',
            'berlin techno', 'detroit techno', 'schranz', 'hypnotic techno', 'driving techno'
        ]
    },
    'Hard Dance': {
        slug: 'hard-dance',
        aliases: [
            'hardstyle', 'rawstyle', 'euphoric hardstyle', 'xtra raw', 'hardcore',
            'frenchcore', 'uptempo', 'uptempo hardcore', 'gabber', 'happy hardcore',
            'uk hardcore', 'reverse bass', 'crossbreed', 'terrorcore', 'speedcore',
            'hard dance', 'jumpstyle', 'hard bass'
        ]
    },
    'Dubstep & Bass': {
        slug: 'dubstep-bass',
        aliases: [
            'dubstep', 'riddim', 'tearout', 'melodic dubstep', 'color bass',
            'colour bass', 'trap', 'hybrid trap', 'wave', 'hardwave', 'future bass',
            'trench', 'brostep', 'deep dubstep', 'leftfield bass', 'freeform bass',
            'midtempo', 'glitch hop', 'neurohop'
        ]
    },
    'Garage & UK Bass': {
        slug: 'garage',
        aliases: [
            'uk garage', 'ukg', 'garage', '2-step', '2step', 'bassline', 'speed garage',
            'uk bass', 'grime', 'future garage', 'breaks', 'breakbeat', 'nu skool breaks'
        ]
    },
    'Synth & Cyberpunk': {
        slug: 'synth-retro',
        aliases: [
            'synthwave', 'retrowave', 'darksynth', 'outrun', 'vaporwave', 'future funk',
            'cyberpunk', 'chiptune', '80s', '80s synth', 'synthpop', 'electropop'
        ]
    },
    'Ambient & Chill': {
        slug: 'ambient-chill',
        aliases: [
            'ambient', 'downtempo', 'chillout', 'chill', 'lo-fi', 'lofi', 'idm',
            'experimental', 'drone', 'cinematic', 'lounge', 'trip hop', 'illbient'
        ]
    },
    'Disco & Funk': {
        slug: 'disco-funk',
        aliases: [
            'disco', 'nu-disco', 'nudisco', 'funk', 'electro funk', 'groove',
            'boogie', 'italo disco'
        ]
    },
    'Hardgroove & Tribal': {
        slug: 'hardgroove',
        aliases: [
            'hardgroove', 'hard groove', 'tribal', 'percussive techno', 'groove techno'
        ]
    }
};

// Popular suggestions for autocomplete in UI
const POPULAR_GENRES = [
    'House', 'Tech House', 'Deep House', 'Bass House', 'Progressive House', 'Electro House', 'Melodic House',
    'Techno', 'Hard Techno', 'Melodic Techno', 'Industrial Techno', 'Acid Techno', 'Peak Time Techno',
    'Trance', 'Melodic Trance', 'Psytrance', 'Uplifting Trance', 'Tech Trance', 'Vocal Trance', 'Progressive Trance',
    'Drum & Bass', 'Liquid DNB', 'Neurofunk', 'Jump Up', 'Jungle', 'Halftime',
    'Hardstyle', 'Rawstyle', 'Euphoric Hardstyle', 'Hardcore', 'Frenchcore', 'Uptempo', 'Happy Hardcore',
    'Dubstep', 'Riddim', 'Melodic Dubstep', 'Color Bass', 'Tearout', 'Trap', 'Wave', 'Future Bass',
    'UK Garage', 'Bassline', 'Breakbeat',
    'Synthwave', 'Darksynth', 'Retrowave', 'Cyberpunk',
    'Midtempo', 'Glitch Hop', 'Ambient', 'Downtempo', 'Nu-Disco'
];

/**
 * Universal delimiter parser: converts JSON string, array, or delimiter-separated string into string[]
 */
function parseGenres(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map(g => (typeof g === 'string' ? g.trim() : String(g))).filter(Boolean);
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        
        // If stored as JSON string
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map(g => (typeof g === 'string' ? g.trim() : String(g))).filter(Boolean);
                }
            } catch (e) {}
        }
        
        // Split on common separators (/ , | ; +)
        return trimmed
            .split(/\s*[\/,|;+]\s*/)
            .map(g => g.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * Maps any subgenre, alias, or tag to its Master Parent Category
 */
function getParentCategory(genreString) {
    if (!genreString) return 'Other';
    const clean = genreString.toLowerCase().trim().replace(/[^a-z0-9&]/g, ' ').replace(/\s+/g, ' ');

    for (const [categoryName, data] of Object.entries(GENRE_TAXONOMY)) {
        if (data.aliases.some(alias => {
            const aliasClean = alias.toLowerCase().replace(/[^a-z0-9&]/g, ' ').replace(/\s+/g, ' ');
            return clean === aliasClean || clean.includes(aliasClean) || aliasClean.includes(clean);
        })) {
            return categoryName;
        }
    }

    // Default fallback: Capitalize first letter of unmatched genre
    return genreString.charAt(0).toUpperCase() + genreString.slice(1);
}

module.exports = {
    GENRE_TAXONOMY,
    POPULAR_GENRES,
    parseGenres,
    getParentCategory
};
