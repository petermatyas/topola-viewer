import {describe, expect, it} from '@jest/globals';
import {TreeNode} from 'topola';
import {
  busYAbove,
  familyLinkPath,
  findFreeX,
  GENERATION_YEARS,
  LayoutNode,
  PersonDates,
  personKey,
  PIXELS_PER_YEAR,
  placeInTime,
  toYear,
} from './timeline_hourglass_chart';

const HEADER = 60;

function node(
  id: string,
  generation: number,
  x: number,
  parent: LayoutNode | null = null,
  spouse?: string,
): LayoutNode {
  const data: TreeNode = {
    id,
    indi: {id, width: 100},
    spouse: spouse ? {id: spouse, width: 100} : undefined,
    generation,
    width: spouse ? 200 : 100,
    height: HEADER,
  };
  return {x, y: 0, data, parent};
}

function people(
  list: Record<string, [number | null, number | null, boolean?]>,
): (id: string) => PersonDates {
  return (id) => {
    const [birth, death, living] = list[id] ?? [null, null];
    return {birth, death, living: !!living, headerHeight: HEADER};
  };
}

const top = (n: LayoutNode) => n.y - (n.data.height ?? 0) / 2;
const left = (n: LayoutNode) => n.x - (n.data.width ?? 0) / 2;
const right = (n: LayoutNode) => n.x + (n.data.width ?? 0) / 2;

describe('toYear', () => {
  it('converts dates and ranges to fractional years', () => {
    expect(toYear({date: {year: 1868}})).toBe(1868.5);
    expect(toYear({date: {year: 1868, month: 1, day: 1}})).toBeCloseTo(
      1868.0,
      1,
    );
    expect(toYear({date: {year: 1868, month: 12}})).toBeCloseTo(1868.96, 2);
    expect(toYear({dateRange: {from: {year: 1850}, to: {year: 1860}}})).toBe(
      1855.5,
    );
    expect(toYear({dateRange: {to: {year: 1850}}})).toBe(1850.5);
    expect(toYear({date: {text: 'unknown'}})).toBeNull();
    expect(toYear(null)).toBeNull();
  });
});

describe('placeInTime', () => {
  it('places boxes at birth years with the height of the lifespan', () => {
    const root = node('child', 0, 0);
    const parents = node('father', -1, 0, root, 'mother');
    const dates = people({
      father: [1800, 1870],
      mother: [1805, null],
      child: [1840, null, true],
    });
    const layout = placeInTime([parents, root], dates, () => null, 2000);
    const s = PIXELS_PER_YEAR;
    expect(top(root) - top(parents)).toBeCloseTo(40 * s);
    const father = layout.persons.get(personKey('father', -1));
    const mother = layout.persons.get(personKey('mother', -1));
    const child = layout.persons.get(personKey('child', 0));
    expect(father).toMatchObject({offset: 0, height: 70 * s});
    // The spouse's box starts at her own birth; unknown death: text height.
    expect(mother).toMatchObject({offset: 5 * s, height: HEADER});
    // Possibly living: until today.
    expect(child?.height).toBeCloseTo(160.5 * s);
    expect(parents.data.height).toBe(70 * s);
  });

  it('puts the marriage box at the year of the marriage', () => {
    const parents = node('father', -1, 0, null, 'mother');
    parents.data.family = {id: 'F1', width: 80, height: 20};
    const dates = people({father: [1800, 1870], mother: [1805, 1880]});
    const layout = placeInTime([parents], dates, () => 1830, 2000);
    expect(layout.families.get('father')).toBeCloseTo(30 * PIXELS_PER_YEAR);
  });

  it('moves boxes that overlap in time to the side', () => {
    const root = node('child', 0, 0);
    const parents = node('father', -1, 0, root, 'mother');
    const dates = people({
      father: [1800, 1870],
      mother: [1805, 1880],
      child: [1830, 1900],
    });
    placeInTime([parents, root], dates, () => null, 2000);
    expect(left(root) >= right(parents) || right(root) <= left(parents)).toBe(
      true,
    );
  });

  it('puts all children on the right side of parents living at their time', () => {
    // Descendants: the children are below the parents (higher generation),
    // centered under them as in topola's layout.
    const parents = node('father', 0, 0, null, 'mother');
    const kids = [-250, 0, 250].map((x, i) => node(`c${i}`, 1, x, parents));
    // A branch on the right of the family, at the children's generation.
    const uncle = node('uncle', 0, 500);
    const cousin = node('cousin', 1, 500, uncle);
    const dates = people({
      father: [1800, 1880],
      mother: [1805, 1885],
      c0: [1830, 1900],
      c1: [1834, 1900],
      c2: [1838, 1900],
      uncle: [1802, 1880],
      cousin: [1832, 1900],
    });
    placeInTime([parents, ...kids, uncle, cousin], dates, () => null, 2000);
    for (const kid of kids) {
      expect(left(kid)).toBeGreaterThanOrEqual(right(parents));
    }
    // The children keep their order and stay on the left of the other branch.
    expect(left(kids[1])).toBeGreaterThan(left(kids[0]));
    expect(left(kids[2])).toBeGreaterThan(left(kids[1]));
    expect(left(cousin)).toBeGreaterThan(right(kids[2]));
  });

  it('moves a sibling of the parents out of the way of the children', () => {
    const grandparents = node('gf', 0, 0, null, 'gm');
    const parents = node('father', 1, -150, grandparents, 'mother');
    // Box at the time of the line to the children, where the children go.
    const aunt = node('aunt', 1, 150, grandparents);
    const kids = [-300, -150, 0].map((x, i) => node(`c${i}`, 2, x, parents));
    const dates = people({
      gf: [1770, 1800],
      gm: [1772, 1802],
      father: [1800, 1880],
      mother: [1805, 1885],
      aunt: [1806, 1880],
      c0: [1830, 1900],
      c1: [1834, 1900],
      c2: [1838, 1900],
    });
    placeInTime(
      [grandparents, parents, aunt, ...kids],
      dates,
      () => null,
      2000,
    );
    for (const kid of kids) {
      expect(left(kid)).toBeGreaterThanOrEqual(right(parents));
      expect(right(kid)).toBeLessThanOrEqual(left(aunt));
    }
  });

  it('keeps children below parents who died before their time', () => {
    const parents = node('father', 0, 0, null, 'mother');
    const kids = [-100, 100].map((x, i) => node(`c${i}`, 1, x, parents));
    const dates = people({
      father: [1800, 1820],
      mother: [1805, 1825],
      c0: [1840, 1900],
      c1: [1844, 1900],
    });
    placeInTime([parents, ...kids], dates, () => null, 2000);
    expect(kids.map((k) => k.x)).toEqual([-100, 100]);
  });

  it('keeps boxes that do not overlap in time in place', () => {
    const root = node('child', 0, 0);
    const parents = node('father', -1, 0, root, 'mother');
    const dates = people({
      father: [1800, 1820],
      mother: [1805, 1825],
      child: [1840, 1900],
    });
    placeInTime([parents, root], dates, () => null, 2000);
    expect(root.x).toBe(0);
    expect(parents.x).toBe(0);
  });

  it('estimates undated boxes from the nearest dated generation', () => {
    const root = node('child', 0, 0);
    const parents = node('parent', -1, 0, root);
    const grandparents = node('grandparent', -2, 0, parents);
    placeInTime(
      [grandparents, parents, root],
      people({child: [1900, 1960]}),
      () => null,
      2000,
    );
    expect(top(root) - top(grandparents)).toBeCloseTo(
      2 * GENERATION_YEARS * PIXELS_PER_YEAR,
    );
    expect(top(parents) - top(grandparents)).toBeCloseTo(
      GENERATION_YEARS * PIXELS_PER_YEAR,
    );
  });
});

describe('familyLinkPath', () => {
  it('goes straight down to a box below the family', () => {
    expect(familyLinkPath(50, 10, 28, {x0: 0, x1: 100, y0: 40})).toBe(
      'M 50 10 L 50 40',
    );
  });

  it('runs along the family line above the box and drops to its middle', () => {
    expect(familyLinkPath(50, 10, 28, {x0: 200, x1: 300, y0: 40})).toBe(
      'M 50 10 L 50 28 L 250 28 L 250 40',
    );
    expect(familyLinkPath(50, 10, 28, {x0: -300, x1: -200, y0: 40})).toBe(
      'M 50 10 L 50 28 L -250 28 L -250 40',
    );
  });

  it('draws all children of a family on one line above their boxes', () => {
    const boxes = [
      {x0: 100, x1: 150, y0: 20},
      {x0: 200, x1: 250, y0: 36},
      {x0: 300, x1: 350, y0: 52},
    ];
    const busY = Math.min(...boxes.map(busYAbove));
    expect(busY).toBeLessThan(20);
    expect(boxes.map((box) => familyLinkPath(0, 10, busY, box))).toEqual([
      `M 0 10 L 0 ${busY} L 125 ${busY} L 125 20`,
      `M 0 10 L 0 ${busY} L 225 ${busY} L 225 36`,
      `M 0 10 L 0 ${busY} L 325 ${busY} L 325 52`,
    ]);
  });
});

describe('findFreeX', () => {
  it('keeps the position if it is free', () => {
    expect(findFreeX(10, 50, 500, [[100, 200]])).toBe(10);
  });

  it('moves the label after the boxes in the way', () => {
    expect(
      findFreeX(10, 50, 500, [
        [0, 100],
        [120, 200],
      ]),
    ).toBe(206);
  });

  it('returns null if the label does not fit', () => {
    expect(findFreeX(10, 50, 230, [[0, 200]])).toBeNull();
  });
});
