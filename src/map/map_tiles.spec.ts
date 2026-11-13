import {describe, expect, it} from '@jest/globals';
import {defaultTileSource, TILE_SOURCES, tileSources} from './map_tiles';

describe('defaultTileSource', () => {
  it('uses OpenStreetMap on web pages', () => {
    expect(defaultTileSource(TILE_SOURCES, 'https:', null).id).toBe('osm');
  });

  it('uses OpenStreetMap France on file:// pages', () => {
    expect(defaultTileSource(TILE_SOURCES, 'file:', null).id).toBe('osmfr');
  });

  it('prefers the saved choice', () => {
    expect(defaultTileSource(TILE_SOURCES, 'file:', 'opentopomap').id).toBe(
      'opentopomap',
    );
  });

  it('ignores an unknown saved choice', () => {
    expect(defaultTileSource(TILE_SOURCES, 'https:', 'carto').id).toBe('osm');
  });

  it('uses the custom tile URL first', () => {
    const sources = tileSources('https://example.com/{z}/{x}/{y}.png');
    expect(defaultTileSource(sources, 'file:', null).id).toBe('custom');
    expect(sources).toHaveLength(TILE_SOURCES.length + 1);
  });
});
