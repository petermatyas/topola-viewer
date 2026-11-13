import {JsonFam, JsonIndi} from 'topola';
import {
  ancestorIds,
  descendantIds,
  hourglassIds,
  immediateFamily,
} from './movements';
import {
  ALL_EVENT_CATEGORIES,
  EventCategory,
  hasCoordinates,
  PlaceData,
  PlacedEvent,
} from './places';

/** Which individuals are shown on the map. */
export enum PeopleScope {
  /** Individuals visible in the chart (default). */
  CHART = 'chart',
  ALL = 'all',
  PERSON = 'person',
  FAMILY = 'family',
  ANCESTORS = 'ancestors',
  DESCENDANTS = 'descendants',
}

/** Which movement lines are drawn. */
export enum MovementMode {
  /** Migration of the ancestors of the selected individual (default). */
  ANCESTORS = 'ancestors',
  /** Personal paths of the selected individual, spouses and children. */
  FAMILY = 'family',
  /** Personal path of the selected individual. */
  PERSON = 'person',
  OFF = 'off',
}

export interface MapFilters {
  scope: PeopleScope;
  categories: EventCategory[];
  fromYear?: number;
  toYear?: number;
  showUndated: boolean;
  /** Case-insensitive part of the surname, empty means no filtering. */
  surname: string;
  movements: MovementMode;
}

export const DEFAULT_MAP_FILTERS: MapFilters = {
  scope: PeopleScope.CHART,
  categories: ALL_EVENT_CATEGORIES,
  showUndated: true,
  surname: '',
  movements: MovementMode.ANCESTORS,
};

type Query = Record<string, string | (string | null)[] | null | undefined>;

function single(value: Query[string]): string | undefined {
  const result = Array.isArray(value) ? value[0] : value;
  return result ?? undefined;
}

function parseYear(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) {
    return undefined;
  }
  return parseInt(value, 10);
}

function parseEnum<T extends string>(
  values: Record<string, T>,
  value: string | undefined,
  defaultValue: T,
): T {
  return (Object.values(values) as string[]).includes(value ?? '')
    ? (value as T)
    : defaultValue;
}

/** Reads the map filters from the URL query parameters. */
export function parseMapFilters(query: Query): MapFilters {
  const types = single(query.mtypes);
  const categories =
    types === undefined
      ? DEFAULT_MAP_FILTERS.categories
      : ALL_EVENT_CATEGORIES.filter((category) =>
          types.split(',').includes(category),
        );
  return {
    scope: parseEnum(PeopleScope, single(query.mscope), PeopleScope.CHART),
    categories,
    fromYear: parseYear(single(query.mfrom)),
    toYear: parseYear(single(query.mto)),
    showUndated: single(query.mundated) !== 'false',
    surname: single(query.msurname) ?? '',
    movements: parseEnum(
      MovementMode,
      single(query.mmove),
      MovementMode.ANCESTORS,
    ),
  };
}

/** URL query parameters for the map filters. Default values are removed. */
export function mapFiltersToArgs(
  filters: MapFilters,
): Record<string, string | null> {
  const allCategories =
    filters.categories.length === ALL_EVENT_CATEGORIES.length;
  return {
    mscope: filters.scope === PeopleScope.CHART ? null : filters.scope,
    mtypes: allCategories ? null : filters.categories.join(','),
    mfrom: filters.fromYear !== undefined ? String(filters.fromYear) : null,
    mto: filters.toYear !== undefined ? String(filters.toYear) : null,
    mundated: filters.showUndated ? null : 'false',
    msurname: filters.surname ? filters.surname : null,
    mmove:
      filters.movements === MovementMode.ANCESTORS ? null : filters.movements,
  };
}

export interface ChartScope {
  selectionId: string;
  ancestorGenerations?: number;
  descendantGenerations?: number;
}

/** Returns the individuals selected by the scope and surname filters. */
export function selectPeople(
  filters: MapFilters,
  chart: ChartScope,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
): Set<string> {
  const id = chart.selectionId;
  let people: Set<string>;
  switch (filters.scope) {
    case PeopleScope.ALL:
      people = new Set(indiMap.keys());
      break;
    case PeopleScope.PERSON:
      people = new Set([id]);
      break;
    case PeopleScope.FAMILY:
      people = new Set(immediateFamily(id, indiMap, famMap));
      break;
    case PeopleScope.ANCESTORS:
      people = new Set([id, ...ancestorIds(id, indiMap, famMap)]);
      break;
    case PeopleScope.DESCENDANTS:
      people = new Set([id, ...descendantIds(id, indiMap, famMap)]);
      break;
    default:
      people = hourglassIds(
        id,
        indiMap,
        famMap,
        chart.ancestorGenerations,
        chart.descendantGenerations,
      );
  }
  const surname = filters.surname.trim().toLowerCase();
  if (!surname) {
    return people;
  }
  return new Set(
    [...people].filter((indiId) => {
      const indi = indiMap.get(indiId);
      return [indi?.lastName, indi?.maidenName].some((name) =>
        name?.toLowerCase().includes(surname),
      );
    }),
  );
}

/**
 * Returns the events of the given individuals that pass the event type and
 * time filters.
 *
 * @param untilYear overrides the end of the time range (used for playback)
 */
export function filterEvents(
  data: PlaceData,
  people: Set<string>,
  filters: MapFilters,
  untilYear?: number,
): PlacedEvent[] {
  const toYear = untilYear ?? filters.toYear;
  return data.events.filter((event) => {
    if (!people.has(event.indiId)) {
      return false;
    }
    if (!filters.categories.includes(event.category)) {
      return false;
    }
    if (event.year === undefined) {
      return filters.showUndated && untilYear === undefined;
    }
    return (
      (filters.fromYear === undefined || event.year >= filters.fromYear) &&
      (toYear === undefined || event.year <= toYear)
    );
  });
}

export interface MissingSummary {
  /** Individuals without any event with a place. */
  noPlace: number;
  /** Individuals with places, but none of them with coordinates. */
  noCoordinates: number;
}

/** Counts the selected individuals that cannot be shown on the map. */
export function missingSummary(
  data: PlaceData,
  people: Set<string>,
): MissingSummary {
  const result = {noPlace: 0, noCoordinates: 0};
  people.forEach((indiId) => {
    const events = data.eventsByIndi.get(indiId) ?? [];
    if (!events.length) {
      result.noPlace++;
    } else if (
      !events.some((event) => hasCoordinates(data.places.get(event.placeKey)))
    ) {
      result.noCoordinates++;
    }
  });
  return result;
}

/** Year range of all dated events, undefined if there are none. */
export function yearRange(data: PlaceData): [number, number] | undefined {
  const years = data.events
    .map((event) => event.year)
    .filter((year): year is number => year !== undefined);
  if (!years.length) {
    return undefined;
  }
  return [Math.min(...years), Math.max(...years)];
}
