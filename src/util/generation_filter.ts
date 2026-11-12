import {JsonFam, JsonGedcomData, JsonIndi} from 'topola';

/**
 * Returns a copy of the data containing only individuals whose generation
 * relative to the start individual is within the given limits.
 *
 * Generation offsets are computed by walking the family graph from the start
 * individual: parents are one generation up (-1), children one generation
 * down (+1), spouses and siblings stay in the same generation.
 *
 * @param ancestors maximum number of generations above the start individual,
 *   undefined means no limit
 * @param descendants maximum number of generations below the start
 *   individual, undefined means no limit
 */
export function filterByGenerations(
  data: JsonGedcomData,
  startId: string,
  ancestors: number | undefined,
  descendants: number | undefined,
): JsonGedcomData {
  if (ancestors === undefined && descendants === undefined) {
    return data;
  }
  const indiMap = new Map<string, JsonIndi>(data.indis.map((i) => [i.id, i]));
  const famMap = new Map<string, JsonFam>(data.fams.map((f) => [f.id, f]));
  if (!indiMap.has(startId)) {
    return data;
  }

  const inRange = (generation: number) =>
    (ancestors === undefined || generation >= -ancestors) &&
    (descendants === undefined || generation <= descendants);

  // Breadth-first search assigning a generation offset to each individual.
  const generations = new Map<string, number>([[startId, 0]]);
  const queue = [startId];
  const visit = (id: string | undefined, generation: number) => {
    if (
      id === undefined ||
      generations.has(id) ||
      !indiMap.has(id) ||
      !inRange(generation)
    ) {
      return;
    }
    generations.set(id, generation);
    queue.push(id);
  };

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const generation = generations.get(id);
    const indi = indiMap.get(id);
    if (generation === undefined || indi === undefined) {
      continue;
    }
    const parentFam = indi.famc ? famMap.get(indi.famc) : undefined;
    if (parentFam) {
      visit(parentFam.husb, generation - 1);
      visit(parentFam.wife, generation - 1);
      parentFam.children?.forEach((sibling) => visit(sibling, generation));
    }
    indi.fams?.forEach((famId) => {
      const fam = famMap.get(famId);
      if (fam) {
        visit(fam.husb, generation);
        visit(fam.wife, generation);
        fam.children?.forEach((child) => visit(child, generation + 1));
      }
    });
  }

  const keepIndi = (id: string | undefined) =>
    id !== undefined && generations.has(id);

  // Keep only families that still have at least one parent.
  const fams = data.fams
    .filter((fam) => keepIndi(fam.husb) || keepIndi(fam.wife))
    .map((fam) => ({
      ...fam,
      husb: keepIndi(fam.husb) ? fam.husb : undefined,
      wife: keepIndi(fam.wife) ? fam.wife : undefined,
      children: fam.children?.filter(keepIndi),
    }));
  const keptFams = new Set(fams.map((fam) => fam.id));

  const indis = data.indis
    .filter((indi) => keepIndi(indi.id))
    .map((indi) => ({
      ...indi,
      famc: indi.famc && keptFams.has(indi.famc) ? indi.famc : undefined,
      fams: indi.fams?.filter((famId) => keptFams.has(famId)),
    }));

  return {...data, indis, fams};
}
