import {GedcomEntry} from 'parse-gedcom';
import {getDate} from 'topola';
import {GedcomData, pointerToId} from '../util/gedcom_util';

/** Groups of events, used for marker colors and filtering. */
export enum EventCategory {
  BIRTH = 'birth',
  MARRIAGE = 'marriage',
  RESIDENCE = 'residence',
  DEATH = 'death',
  OTHER = 'other',
}

export const ALL_EVENT_CATEGORIES = [
  EventCategory.BIRTH,
  EventCategory.MARRIAGE,
  EventCategory.RESIDENCE,
  EventCategory.DEATH,
  EventCategory.OTHER,
];

const CATEGORY_BY_TAG = new Map<string, EventCategory>([
  ['BIRT', EventCategory.BIRTH],
  ['CHR', EventCategory.BIRTH],
  ['BAPM', EventCategory.BIRTH],
  ['MARR', EventCategory.MARRIAGE],
  ['MARB', EventCategory.MARRIAGE],
  ['MARC', EventCategory.MARRIAGE],
  ['MARL', EventCategory.MARRIAGE],
  ['MARS', EventCategory.MARRIAGE],
  ['ENGA', EventCategory.MARRIAGE],
  ['DIV', EventCategory.MARRIAGE],
  ['DIVF', EventCategory.MARRIAGE],
  ['RESI', EventCategory.RESIDENCE],
  ['DEAT', EventCategory.DEATH],
  ['BURI', EventCategory.DEATH],
  ['CREM', EventCategory.DEATH],
]);

/** Event tags that start a life, used to order undated events. */
const START_TAGS = ['BIRT', 'CHR', 'BAPM'];
/** Event tags that end a life, used to order undated events. */
const END_TAGS = ['DEAT', 'BURI', 'CREM'];

/** An event of an individual that happened at a known place. */
export interface PlacedEvent {
  indiId: string;
  /** Set for family events (e.g. marriage). */
  famId?: string;
  /** GEDCOM tag, e.g. BIRT. */
  tag: string;
  category: EventCategory;
  /** Year of the event, undefined if the event has no usable date. */
  year?: number;
  /** True if the date is estimated, a range or not exact. */
  approximate: boolean;
  /** Normalized place name. */
  placeKey: string;
}

export interface Place {
  /** Normalized place name. */
  key: string;
  lat?: number;
  lon?: number;
  /** Number of GEDCOM events referring to this place. */
  refCount: number;
  /** True if the GEDCOM contains different coordinates for this place. */
  conflict: boolean;
}

export interface PlaceData {
  events: PlacedEvent[];
  places: Map<string, Place>;
  /** Placed events grouped by individual. */
  eventsByIndi: Map<string, PlacedEvent[]>;
}

/**
 * Normalizes a place name: trims the comma-separated parts and drops the empty
 * ones. Returns undefined if nothing is left (e.g. for ",,,").
 */
export function normalizePlace(place: string | undefined): string | undefined {
  if (!place) {
    return undefined;
  }
  const parts = place
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length ? parts.join(', ') : undefined;
}

/**
 * Parses a GEDCOM coordinate, e.g. "N47.229722", "E16.618611", "S12.5" or
 * "-12.5". Returns undefined for invalid or out of range values.
 *
 * @param max maximum absolute value (90 for latitude, 180 for longitude)
 */
export function parseCoordinate(
  value: string | undefined,
  max: number,
): number | undefined {
  const match = value
    ?.trim()
    .match(/^([NSEW])?\s*([-+]?\d+(?:\.\d+)?)\s*([NSEW])?$/i);
  if (!match) {
    return undefined;
  }
  const direction = (match[1] || match[3] || '').toUpperCase();
  let result = parseFloat(match[2]);
  if (direction === 'S' || direction === 'W') {
    result = -Math.abs(result);
  }
  if (isNaN(result) || Math.abs(result) > max) {
    return undefined;
  }
  return result;
}

/** Returns the year of a GEDCOM date and whether the date is approximate. */
export function parseEventYear(gedcomDate: string | undefined): {
  year?: number;
  approximate: boolean;
} {
  if (!gedcomDate?.trim()) {
    return {approximate: false};
  }
  const parsed = getDate(gedcomDate);
  const date = parsed?.date;
  if (date?.year !== undefined) {
    return {year: date.year, approximate: !!date.qualifier};
  }
  const range = parsed?.dateRange;
  const rangeYear = range?.from?.year ?? range?.to?.year;
  if (rangeYear !== undefined) {
    return {year: rangeYear, approximate: true};
  }
  // Fallback for forms not parsed by topola, e.g. "FROM 1900 TO 1910".
  const match = gedcomDate.match(/\b(\d{3,4})\b/);
  if (match) {
    return {year: parseInt(match[1], 10), approximate: true};
  }
  return {approximate: false};
}

function findTag(entry: GedcomEntry, tag: string) {
  return entry.tree.find((child) => child.tag === tag);
}

function findTags(entry: GedcomEntry, tag: string) {
  return entry.tree.filter((child) => child.tag === tag);
}

/** Text of an entry including its CONT/CONC continuation lines. */
function fullText(entry: GedcomEntry): string {
  let result = entry.data || '';
  for (const child of entry.tree) {
    if (child.tag === 'CONT') {
      result += ', ' + (child.data || '');
    } else if (child.tag === 'CONC') {
      result += child.data || '';
    }
  }
  return result;
}

/** Place name of an event: PLAC, otherwise ADDR/CITY, otherwise ADDR. */
function eventPlace(event: GedcomEntry): string | undefined {
  const plac = normalizePlace(findTag(event, 'PLAC')?.data);
  if (plac) {
    return plac;
  }
  const addr = findTag(event, 'ADDR');
  if (!addr) {
    return undefined;
  }
  return (
    normalizePlace(findTag(addr, 'CITY')?.data) ??
    normalizePlace(fullText(addr))
  );
}

/** Coordinates from PLAC/MAP/LATI+LONG, if present and valid. */
function eventCoordinates(event: GedcomEntry): [number, number] | undefined {
  const plac = findTag(event, 'PLAC');
  const map = plac && findTag(plac, 'MAP');
  if (!map) {
    return undefined;
  }
  const lat = parseCoordinate(findTag(map, 'LATI')?.data, 90);
  const lon = parseCoordinate(findTag(map, 'LONG')?.data, 180);
  return lat !== undefined && lon !== undefined ? [lat, lon] : undefined;
}

/**
 * Collects all events with a place from the GEDCOM data, together with the
 * coordinates of the places.
 *
 * Coordinates are stored per place name: if any occurrence of a place has
 * coordinates, they apply to all occurrences. If different coordinates are
 * given for the same place, the most frequent one is used and the place is
 * marked as conflicting.
 */
export function extractPlaces(gedcom: GedcomData): PlaceData {
  const events: PlacedEvent[] = [];
  const refCounts = new Map<string, number>();
  // place -> "lat,lon" -> number of occurrences
  const coordinateCounts = new Map<string, Map<string, number>>();

  function processEvent(event: GedcomEntry, indiIds: string[], famId?: string) {
    const placeKey = eventPlace(event);
    if (!placeKey) {
      return;
    }
    refCounts.set(placeKey, (refCounts.get(placeKey) ?? 0) + 1);
    const coordinates = eventCoordinates(event);
    if (coordinates) {
      const counts = coordinateCounts.get(placeKey) ?? new Map();
      const key = coordinates.join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      coordinateCounts.set(placeKey, counts);
    }
    const {year, approximate} = parseEventYear(findTag(event, 'DATE')?.data);
    for (const indiId of indiIds) {
      events.push({
        indiId,
        famId,
        tag: event.tag,
        category: CATEGORY_BY_TAG.get(event.tag) ?? EventCategory.OTHER,
        year,
        approximate,
        placeKey,
      });
    }
  }

  for (const indi of Object.values(gedcom.indis)) {
    const indiId = pointerToId(indi.pointer);
    for (const event of indi.tree) {
      processEvent(event, [indiId]);
    }
  }
  for (const fam of Object.values(gedcom.fams)) {
    const famId = pointerToId(fam.pointer);
    const spouses = [...findTags(fam, 'HUSB'), ...findTags(fam, 'WIFE')]
      .map((entry) => entry.data && pointerToId(entry.data))
      .filter((id): id is string => !!id && !!gedcom.indis[id]);
    for (const event of fam.tree) {
      if (
        event.tag !== 'HUSB' &&
        event.tag !== 'WIFE' &&
        event.tag !== 'CHIL'
      ) {
        processEvent(event, spouses, famId);
      }
    }
  }

  const places = new Map<string, Place>();
  refCounts.forEach((refCount, key) => {
    const place: Place = {key, refCount, conflict: false};
    const counts = coordinateCounts.get(key);
    if (counts) {
      const [best] = [...counts].sort((a, b) => b[1] - a[1])[0];
      [place.lat, place.lon] = best.split(',').map(Number);
      place.conflict = counts.size > 1;
    }
    places.set(key, place);
  });

  const eventsByIndi = new Map<string, PlacedEvent[]>();
  for (const event of events) {
    const list = eventsByIndi.get(event.indiId) ?? [];
    list.push(event);
    eventsByIndi.set(event.indiId, list);
  }

  return {events, places, eventsByIndi};
}

export function hasCoordinates(
  place: Place | undefined,
): place is Place & {lat: number; lon: number} {
  return place?.lat !== undefined && place?.lon !== undefined;
}

/**
 * Sort rank of an event: undated life-starting events come first, undated
 * life-ending events last. Other undated events cannot be placed in time and
 * get undefined.
 */
export function eventSortKey(event: PlacedEvent): number | undefined {
  if (event.year !== undefined) {
    // Within the same year: birth first, death last.
    const offset = START_TAGS.includes(event.tag)
      ? 0
      : END_TAGS.includes(event.tag)
        ? 0.2
        : 0.1;
    return event.year + offset;
  }
  if (START_TAGS.includes(event.tag)) {
    return -Infinity;
  }
  if (END_TAGS.includes(event.tag)) {
    return Infinity;
  }
  return undefined;
}

/** True if the event is a birth, christening or baptism. */
export function isStartEvent(event: PlacedEvent) {
  return START_TAGS.includes(event.tag);
}
