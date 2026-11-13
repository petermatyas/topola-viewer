import {beforeAll, describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {JsonFam, JsonIndi} from 'topola';
import {convertGedcom, idToFamMap, idToIndiMap} from '../util/gedcom_util';
import {
  DEFAULT_MAP_FILTERS,
  filterEvents,
  mapFiltersToArgs,
  missingSummary,
  MovementMode,
  parseMapFilters,
  PeopleScope,
  selectPeople,
  yearRange,
} from './map_filters';
import {
  ancestorSegments,
  hourglassIds,
  immediateFamily,
  personalPath,
  personalSegments,
} from './movements';
import {EventCategory, extractPlaces, PlaceData} from './places';

// Family in map.ged:
// I4 (Hegyvaros) -> I2 (Erdoszel, est.) + I3 (no place) -> I1 (Alfold)
// I1 + I5 (Faluvég, no coordinates) -> I6 (Hegyvaros), I7 (Faluvég), I8 (no place)
let places: PlaceData;
let indiMap: Map<string, JsonIndi>;
let famMap: Map<string, JsonFam>;

beforeAll(async () => {
  const data = await convertGedcom(
    readFileSync('src/datasource/testdata/map.ged', 'utf8'),
    new Map(),
  );
  places = extractPlaces(data.gedcom);
  indiMap = idToIndiMap(data.chartData);
  famMap = idToFamMap(data.chartData);
});

describe('personalPath', () => {
  it('orders places in time and puts undated deaths last', () => {
    const path = personalPath(
      places.eventsByIndi.get('I1') ?? [],
      places.places,
    );
    expect(path.map((e) => e.placeKey)).toEqual([
      'Alfold',
      'Hegyvaros', // RESI 1975
      'Tengerpart', // RESI 1990-2000
      'Hegyvaros', // undated death
    ]);
  });

  it('merges consecutive events at the same place', () => {
    // I1's MARR 1972 and RESI 1975 are both in Hegyvaros.
    const path = personalPath(
      places.eventsByIndi.get('I1') ?? [],
      places.places,
    );
    expect(path.filter((e) => e.placeKey === 'Hegyvaros')).toHaveLength(2);
  });

  it('marks segments with undated or approximate ends as approximate', () => {
    const segments = personalSegments(
      'I1',
      places.eventsByIndi,
      places.places,
      0,
    );
    expect(segments.map((s) => s.approximate)).toEqual([false, true, true]);
  });
});

describe('ancestorSegments', () => {
  it('connects parent and child birth places by generation', () => {
    const segments = ancestorSegments(
      'I6',
      indiMap,
      famMap,
      places.eventsByIndi,
      places.places,
    );
    const lines = segments.map(
      (s) => `${s.fromKey}->${s.toKey}@${s.colorIndex}`,
    );
    expect(lines).toEqual([
      // I6's father I5 has no coordinates: skipped. Mother I1:
      'Alfold->Hegyvaros@0',
      // I1's father I2. Mother I3 has no birth place, falls back to the
      // marriage place, which is the same as I2's birth place.
      'Erdoszel->Alfold@1',
      'Erdoszel->Alfold@1',
      // I2's father I4.
      'Hegyvaros->Erdoszel@2',
    ]);
  });

  it('respects the generation limit', () => {
    const segments = ancestorSegments(
      'I6',
      indiMap,
      famMap,
      places.eventsByIndi,
      places.places,
      1,
    );
    expect(segments).toHaveLength(1);
  });

  it('marks links with estimated dates as approximate', () => {
    const segments = ancestorSegments(
      'I1',
      indiMap,
      famMap,
      places.eventsByIndi,
      places.places,
    );
    // From I2 (born EST 1920), from I3 (marriage 1948), from I4 to I2.
    expect(segments.map((s) => s.approximate)).toEqual([true, false, true]);
  });
});

describe('people selection', () => {
  it('returns the immediate family', () => {
    expect(immediateFamily('I1', indiMap, famMap).sort()).toEqual([
      'I1',
      'I5',
      'I6',
      'I7',
      'I8',
    ]);
  });

  it('returns the hourglass individuals with generation limits', () => {
    expect([...hourglassIds('I1', indiMap, famMap)].sort()).toEqual([
      'I1',
      'I2',
      'I3',
      'I4',
      'I5',
      'I6',
      'I7',
      'I8',
    ]);
    expect([...hourglassIds('I1', indiMap, famMap, 1, 0)].sort()).toEqual([
      'I1',
      'I2',
      'I3',
      'I5',
    ]);
  });

  it('filters by surname', () => {
    const people = selectPeople(
      {...DEFAULT_MAP_FILTERS, scope: PeopleScope.ALL, surname: 'szab'},
      {selectionId: 'I1'},
      indiMap,
      famMap,
    );
    expect([...people].sort()).toEqual(['I5', 'I6', 'I7', 'I8']);
  });
});

describe('filterEvents', () => {
  const all = () => new Set(indiMap.keys());

  it('filters by category and year', () => {
    const events = filterEvents(places, all(), {
      ...DEFAULT_MAP_FILTERS,
      categories: [EventCategory.BIRTH],
      fromYear: 1940,
      toYear: 1960,
      showUndated: false,
    });
    expect(events.map((e) => e.indiId).sort()).toEqual(['I1', 'I5']);
    // I8 was born in 1982 but without a place, so it has no event.
  });

  it('hides undated events during playback', () => {
    const events = filterEvents(places, all(), DEFAULT_MAP_FILTERS, 3000);
    expect(events.some((e) => e.year === undefined)).toBe(false);
  });

  it('counts individuals that cannot be shown', () => {
    expect(missingSummary(places, all())).toEqual({
      noPlace: 1, // I8
      noCoordinates: 1, // I7 (Faluvég only)
    });
  });

  it('returns the year range', () => {
    expect(yearRange(places)).toEqual([1890, 1990]);
  });
});

describe('URL arguments', () => {
  it('round-trips non-default filters', () => {
    const filters = {
      scope: PeopleScope.FAMILY,
      categories: [EventCategory.BIRTH, EventCategory.DEATH],
      fromYear: 1800,
      toYear: 1900,
      showUndated: false,
      surname: 'Kovacs',
      movements: MovementMode.OFF,
    };
    expect(parseMapFilters(mapFiltersToArgs(filters))).toEqual(filters);
  });

  it('omits default values', () => {
    expect(
      Object.values(mapFiltersToArgs(DEFAULT_MAP_FILTERS)).every(
        (v) => v === null,
      ),
    ).toBe(true);
    expect(parseMapFilters({})).toEqual(DEFAULT_MAP_FILTERS);
  });

  it('ignores invalid values', () => {
    expect(parseMapFilters({mscope: 'x', mfrom: 'abc'})).toMatchObject({
      scope: PeopleScope.CHART,
      fromYear: undefined,
    });
  });
});
