import {beforeAll, describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {convertGedcom, TopolaData} from '../util/gedcom_util';
import {
  EventCategory,
  eventSortKey,
  extractPlaces,
  normalizePlace,
  parseCoordinate,
  parseEventYear,
  PlaceData,
} from './places';

describe('normalizePlace', () => {
  it('trims parts and drops empty ones', () => {
    expect(normalizePlace(' Prague ,  Bohemia,, ')).toBe('Prague, Bohemia');
  });

  it('returns undefined for empty places', () => {
    expect(normalizePlace(',,,')).toBeUndefined();
    expect(normalizePlace('  ')).toBeUndefined();
    expect(normalizePlace(undefined)).toBeUndefined();
  });
});

describe('parseCoordinate', () => {
  it('parses direction prefixes', () => {
    expect(parseCoordinate('N47.229722', 90)).toBeCloseTo(47.229722);
    expect(parseCoordinate('E16.618611', 180)).toBeCloseTo(16.618611);
    expect(parseCoordinate('S12.5', 90)).toBe(-12.5);
    expect(parseCoordinate('W0.5', 180)).toBe(-0.5);
  });

  it('parses signed numbers and suffixes', () => {
    expect(parseCoordinate('-33.9', 90)).toBe(-33.9);
    expect(parseCoordinate('12.25 E', 180)).toBe(12.25);
  });

  it('rejects invalid and out of range values', () => {
    expect(parseCoordinate('abc', 90)).toBeUndefined();
    expect(parseCoordinate('N95', 90)).toBeUndefined();
    expect(parseCoordinate('', 90)).toBeUndefined();
    expect(parseCoordinate(undefined, 90)).toBeUndefined();
  });
});

describe('parseEventYear', () => {
  it('parses exact dates', () => {
    expect(parseEventYear('12 MAR 1923')).toEqual({
      year: 1923,
      approximate: false,
    });
    expect(parseEventYear('1939')).toEqual({year: 1939, approximate: false});
  });

  it('marks qualified dates and ranges as approximate', () => {
    expect(parseEventYear('EST 1850')).toEqual({year: 1850, approximate: true});
    expect(parseEventYear('ABT 1900')).toEqual({year: 1900, approximate: true});
    expect(parseEventYear('BET 1850 AND 1860')).toEqual({
      year: 1850,
      approximate: true,
    });
    expect(parseEventYear('BEF 1800')).toEqual({year: 1800, approximate: true});
    expect(parseEventYear('FROM 1900 TO 1910')).toEqual({
      year: 1900,
      approximate: true,
    });
  });

  it('returns no year for missing or unparseable dates', () => {
    expect(parseEventYear(undefined).year).toBeUndefined();
    expect(parseEventYear('EST (2 JUN)').year).toBeUndefined();
  });
});

describe('extractPlaces', () => {
  let data: TopolaData;
  let places: PlaceData;

  beforeAll(async () => {
    data = await convertGedcom(
      readFileSync('src/datasource/testdata/map.ged', 'utf8'),
      new Map(),
    );
    places = extractPlaces(data.gedcom);
  });

  it('collects events missing from the JSON data (RESI)', () => {
    const resi = places.events.filter(
      (e) => e.indiId === 'I1' && e.tag === 'RESI',
    );
    expect(resi.map((e) => e.placeKey)).toEqual(['Hegyvaros', 'Tengerpart']);
    expect(resi[0].category).toBe(EventCategory.RESIDENCE);
  });

  it('uses ADDR/CITY when there is no PLAC', () => {
    const resi = places.events.find(
      (e) => e.indiId === 'I1' && e.tag === 'RESI' && e.year === 1975,
    );
    expect(resi?.placeKey).toBe('Hegyvaros');
  });

  it('skips empty places', () => {
    // I3 was born at ",,,".
    expect(
      places.events.some((e) => e.indiId === 'I3' && e.tag === 'BIRT'),
    ).toBe(false);
  });

  it('assigns family events to both spouses', () => {
    const marriages = places.events.filter((e) => e.famId === 'F1');
    expect(marriages.map((e) => e.indiId).sort()).toEqual(['I2', 'I3']);
  });

  it('applies coordinates to all occurrences of a place', () => {
    const place = places.places.get('Hegyvaros');
    // Occurrences: RESI (ADDR), DEAT, BIRT of I4, BIRT of I6, MARR of F3.
    expect(place?.refCount).toBe(5);
    expect(place?.lat).toBeDefined();
  });

  it('marks conflicting coordinates and uses the most frequent', () => {
    // Hegyvaros has 46.0,18.0 (I4) and 46.1,18.1 (F3 marriage): tie, either is used.
    const place = places.places.get('Hegyvaros');
    expect(place?.conflict).toBe(true);
    const erdoszel = places.places.get('Erdoszel');
    expect(erdoszel).toMatchObject({lat: 48, lon: 21, conflict: false});
  });

  it('leaves places without coordinates', () => {
    expect(places.places.get('Faluvég')).toMatchObject({refCount: 2});
    expect(places.places.get('Faluvég')?.lat).toBeUndefined();
  });

  it('records approximate dates', () => {
    const birth = places.events.find((e) => e.indiId === 'I2');
    expect(birth).toMatchObject({year: 1920, approximate: true});
  });
});

describe('eventSortKey', () => {
  const base = {
    indiId: 'I1',
    category: EventCategory.OTHER,
    approximate: false,
    placeKey: 'X',
  };

  it('puts undated births first and undated deaths last', () => {
    expect(eventSortKey({...base, tag: 'BIRT'})).toBe(-Infinity);
    expect(eventSortKey({...base, tag: 'BURI'})).toBe(Infinity);
    expect(eventSortKey({...base, tag: 'RESI'})).toBeUndefined();
  });

  it('orders events of the same year', () => {
    const birth = eventSortKey({...base, tag: 'BIRT', year: 1900});
    const resi = eventSortKey({...base, tag: 'RESI', year: 1900});
    const death = eventSortKey({...base, tag: 'DEAT', year: 1900});
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(birth! < resi! && resi! < death!).toBe(true);
  });
});
