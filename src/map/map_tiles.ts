const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export interface TileSource {
  id: string;
  /** Name shown in the layer switcher. */
  name: string;
  url: string;
  attribution: string;
  subdomains?: string;
  maxZoom: number;
}

/**
 * Background maps, all rendered from OpenStreetMap data.
 *
 * The tile server of openstreetmap.org may block pages opened from disk
 * (file://), because browsers send no Referer header from them. Therefore the
 * community servers are offered as alternatives, and one of them is the
 * default for file:// pages. (CARTO tiles were tried as well, but they require
 * an API key from file:// pages.)
 */
export const TILE_SOURCES: TileSource[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  },
  {
    id: 'osmfr',
    name: 'OpenStreetMap France',
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attribution:
      OSM_ATTRIBUTION +
      ', tiles &copy; <a href="https://www.openstreetmap.fr/" target="_blank" rel="noopener noreferrer">OpenStreetMap France</a>',
    subdomains: 'abc',
    maxZoom: 20,
  },
  {
    id: 'osmde',
    name: 'OpenStreetMap Deutschland',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attribution:
      OSM_ATTRIBUTION +
      ', tiles &copy; <a href="https://www.openstreetmap.de/" target="_blank" rel="noopener noreferrer">openstreetmap.de</a>',
    maxZoom: 18,
  },
  {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      OSM_ATTRIBUTION +
      ', SRTM | style &copy; <a href="https://opentopomap.org/" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (CC-BY-SA)',
    subdomains: 'abc',
    maxZoom: 17,
  },
];

const STORAGE_KEY = 'topola-map-tiles';

/** Returns the tile sources, with a custom one first if configured. */
export function tileSources(customUrl?: string): TileSource[] {
  if (!customUrl) {
    return TILE_SOURCES;
  }
  return [
    {
      id: 'custom',
      name: 'Custom',
      url: customUrl,
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    },
    ...TILE_SOURCES,
  ];
}

/**
 * The tile source to show initially: the one chosen earlier by the user, the
 * custom one, OpenStreetMap France for file:// pages, or OpenStreetMap.
 */
export function defaultTileSource(
  sources: TileSource[],
  protocol: string,
  savedId: string | null,
): TileSource {
  const saved = sources.find((source) => source.id === savedId);
  if (saved) {
    return saved;
  }
  if (sources[0].id === 'custom') {
    return sources[0];
  }
  const id = protocol === 'file:' ? 'osmfr' : 'osm';
  return sources.find((source) => source.id === id) ?? sources[0];
}

export function loadSavedTileSource(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

export function saveTileSource(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch (e) {
    // Storage is not available, the choice is not remembered.
  }
}
