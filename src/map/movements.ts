import {JsonFam, JsonIndi} from 'topola';
import {
  eventSortKey,
  hasCoordinates,
  isStartEvent,
  Place,
  PlacedEvent,
} from './places';

export type LatLon = [number, number];

/** A line on the map between two places. */
export interface Segment {
  from: LatLon;
  to: LatLon;
  fromKey: string;
  toKey: string;
  /** Dashed line: the date of an end point is estimated or unknown. */
  approximate: boolean;
  /** Index into the color palette. */
  colorIndex: number;
  /** Individual the segment belongs to (for personal paths, the child for ancestor lines). */
  indiId: string;
  /** Year of the end of the segment, used for playback. */
  year?: number;
}

/**
 * Returns the time ordered places of an individual. Events without a date
 * are placed at the start (birth, christening) or the end (death, burial) or
 * are left out. Consecutive events at the same place are merged.
 */
export function personalPath(
  events: PlacedEvent[],
  places: Map<string, Place>,
): PlacedEvent[] {
  const ordered = events
    .filter((event) => hasCoordinates(places.get(event.placeKey)))
    .map((event) => ({event, key: eventSortKey(event)}))
    .filter((e): e is {event: PlacedEvent; key: number} => e.key !== undefined)
    .sort((a, b) => a.key - b.key)
    .map((e) => e.event);
  return ordered.filter(
    (event, i) => i === 0 || event.placeKey !== ordered[i - 1].placeKey,
  );
}

function point(place: Place | undefined): LatLon | undefined {
  return hasCoordinates(place) ? [place.lat, place.lon] : undefined;
}

/** Segments connecting the time ordered places of an individual. */
export function personalSegments(
  indiId: string,
  eventsByIndi: Map<string, PlacedEvent[]>,
  places: Map<string, Place>,
  colorIndex: number,
): Segment[] {
  const path = personalPath(eventsByIndi.get(indiId) ?? [], places);
  const segments: Segment[] = [];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    segments.push({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: point(places.get(from.placeKey))!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: point(places.get(to.placeKey))!,
      fromKey: from.placeKey,
      toKey: to.placeKey,
      approximate:
        from.approximate ||
        to.approximate ||
        from.year === undefined ||
        to.year === undefined,
      colorIndex,
      indiId,
      year: to.year,
    });
  }
  return segments;
}

/** The birth (or christening, baptism) event of an individual with coordinates. */
export function birthEvent(
  indiId: string,
  eventsByIndi: Map<string, PlacedEvent[]>,
  places: Map<string, Place>,
): PlacedEvent | undefined {
  const starts = (eventsByIndi.get(indiId) ?? []).filter(
    (event) =>
      isStartEvent(event) && hasCoordinates(places.get(event.placeKey)),
  );
  // Prefer BIRT over CHR/BAPM.
  return starts.find((event) => event.tag === 'BIRT') ?? starts[0];
}

/** The marriage event of a family with coordinates. */
function marriageEvent(
  famId: string,
  eventsByIndi: Map<string, PlacedEvent[]>,
  places: Map<string, Place>,
  spouseId: string,
): PlacedEvent | undefined {
  return (eventsByIndi.get(spouseId) ?? []).find(
    (event) =>
      event.famId === famId &&
      event.tag === 'MARR' &&
      hasCoordinates(places.get(event.placeKey)),
  );
}

/**
 * Lines showing the migration of the ancestors of an individual: for each
 * parent-child link, a line from the birth place of the parent to the birth
 * place of the child. If the birth place of the parent is not known, the
 * marriage place of the parents is used. Links with unknown places are
 * skipped, but the ancestors above them are still processed.
 *
 * The color index is the generation of the parent (0 for the parents of the
 * start individual).
 */
export function ancestorSegments(
  startId: string,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
  eventsByIndi: Map<string, PlacedEvent[]>,
  places: Map<string, Place>,
  maxGenerations?: number,
): Segment[] {
  const segments: Segment[] = [];
  const visited = new Set<string>([startId]);
  const queue: {id: string; generation: number}[] = [
    {id: startId, generation: 0},
  ];
  while (queue.length) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const {id, generation} = queue.shift()!;
    if (maxGenerations !== undefined && generation >= maxGenerations) {
      continue;
    }
    const famId = indiMap.get(id)?.famc;
    const fam = famId ? famMap.get(famId) : undefined;
    if (!famId || !fam) {
      continue;
    }
    const childBirth = birthEvent(id, eventsByIndi, places);
    for (const parentId of [fam.husb, fam.wife]) {
      if (!parentId || visited.has(parentId) || !indiMap.has(parentId)) {
        continue;
      }
      visited.add(parentId);
      queue.push({id: parentId, generation: generation + 1});
      const parentStart =
        birthEvent(parentId, eventsByIndi, places) ??
        marriageEvent(famId, eventsByIndi, places, parentId);
      if (
        !childBirth ||
        !parentStart ||
        parentStart.placeKey === childBirth.placeKey
      ) {
        continue;
      }
      segments.push({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        from: point(places.get(parentStart.placeKey))!,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        to: point(places.get(childBirth.placeKey))!,
        fromKey: parentStart.placeKey,
        toKey: childBirth.placeKey,
        approximate:
          parentStart.approximate ||
          childBirth.approximate ||
          parentStart.year === undefined ||
          childBirth.year === undefined,
        colorIndex: generation,
        indiId: id,
        year: childBirth.year,
      });
    }
  }
  return segments;
}

/** The individual, their spouses and their children. */
export function immediateFamily(
  indiId: string,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
): string[] {
  const result = [indiId];
  for (const famId of indiMap.get(indiId)?.fams ?? []) {
    const fam = famMap.get(famId);
    if (!fam) {
      continue;
    }
    for (const id of [fam.husb, fam.wife, ...(fam.children ?? [])]) {
      if (id && !result.includes(id) && indiMap.has(id)) {
        result.push(id);
      }
    }
  }
  return result;
}

/** Ancestors of an individual (not including the individual). */
export function ancestorIds(
  indiId: string,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
  maxGenerations?: number,
): Set<string> {
  const result = new Set<string>();
  let current = [indiId];
  for (
    let generation = 0;
    current.length &&
    (maxGenerations === undefined || generation < maxGenerations);
    generation++
  ) {
    const next: string[] = [];
    for (const id of current) {
      const famc = indiMap.get(id)?.famc;
      const fam = famc ? famMap.get(famc) : undefined;
      for (const parent of [fam?.husb, fam?.wife]) {
        if (parent && !result.has(parent) && parent !== indiId) {
          result.add(parent);
          next.push(parent);
        }
      }
    }
    current = next;
  }
  return result;
}

/** Descendants of an individual (not including the individual). */
export function descendantIds(
  indiId: string,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
  maxGenerations?: number,
): Set<string> {
  const result = new Set<string>();
  let current = [indiId];
  for (
    let generation = 0;
    current.length &&
    (maxGenerations === undefined || generation < maxGenerations);
    generation++
  ) {
    const next: string[] = [];
    for (const id of current) {
      for (const famId of indiMap.get(id)?.fams ?? []) {
        for (const child of famMap.get(famId)?.children ?? []) {
          if (!result.has(child) && child !== indiId) {
            result.add(child);
            next.push(child);
          }
        }
      }
    }
    current = next;
  }
  return result;
}

/**
 * Individuals shown in the hourglass chart: the individual, their ancestors,
 * their descendants and the spouses of the individual and the descendants.
 */
export function hourglassIds(
  indiId: string,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
  ancestorGenerations?: number,
  descendantGenerations?: number,
): Set<string> {
  const descendants = descendantIds(
    indiId,
    indiMap,
    famMap,
    descendantGenerations,
  );
  const result = new Set<string>([
    indiId,
    ...ancestorIds(indiId, indiMap, famMap, ancestorGenerations),
    ...descendants,
  ]);
  for (const id of [indiId, ...descendants]) {
    for (const famId of indiMap.get(id)?.fams ?? []) {
      const fam = famMap.get(famId);
      for (const spouse of [fam?.husb, fam?.wife]) {
        if (spouse && indiMap.has(spouse)) {
          result.add(spouse);
        }
      }
    }
  }
  return result;
}
