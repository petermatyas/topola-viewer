import {max, min} from 'd3-array';
import {BaseType, select, Selection} from 'd3-selection';
import 'd3-transition';
import {
  Chart,
  ChartInfo,
  ChartOptions,
  ChartUtil,
  DateOrRange,
  FamDetails,
  getAncestorsTree,
  getChartInfo,
  getFamPositionVertical,
  H_SPACING,
  HIDE_TIME_MS,
  IndiDetails,
  layOutDescendants,
  linkId,
  MOVE_TIME_MS,
  Renderer,
  TreeEntry,
  TreeNode,
  TreeNodeSelection,
} from 'topola';
import {
  getTimelineEvents,
  loadTimelineEvents,
  setTimelineEventsListener,
} from './timeline_events';

/** Assumed number of years between generations, used for undated boxes. */
export const GENERATION_YEARS = 30;
/** Vertical scale of the chart. */
export const PIXELS_PER_YEAR = 4;
/** Without a death date, people born less than this many years ago are shown as living. */
const LIVING_CUTOFF_YEARS = 100;
/** Minimum vertical gap between two boxes that are side by side. */
const MIN_BOX_GAP = 12;
/** Width reserved for the year labels on both sides of the chart. */
const AXIS_WIDTH = 44;
/** Same timing as topola's DetailedRenderer, so that the boxes move together. */
const ANIMATION_DELAY_MS = 200;
const ANIMATION_DURATION_MS = 500;
/** Color of the historical events without their own color. */
const DEFAULT_EVENT_COLOR = '#546e7a';
/** Shorter events are drawn as a line instead of a band. */
const MIN_EVENT_BAND_HEIGHT = 3;
/** Height of the name of an event (font size 11). */
const EVENT_LABEL_HEIGHT = 13;
/** Estimated width of a character of the name of an event (bold, size 11). */
const EVENT_LABEL_CHAR_WIDTH = 6.8;
/** The names of the events are repeated across the chart at this distance. */
const EVENT_LABEL_REPEAT = 1000;

/** The subset of d3's HierarchyPointNode used here. */
export interface LayoutNode {
  x: number;
  y: number;
  data: TreeNode;
  parent: LayoutNode | null;
  children?: LayoutNode[];
}

/** What the layout needs to know about a person. */
export interface PersonDates {
  birth: number | null;
  death: number | null;
  /** No death date, but the person may still be alive. */
  living: boolean;
  /** Height of the box contents (name, dates, places). */
  headerHeight: number;
}

/** A person's box inside a node, relative to the top of the node. */
export interface PersonBox {
  offset: number;
  height: number;
  year: number;
  estimated: boolean;
}

export interface TimelineLayout {
  /** Year at the vertical coordinate 0. */
  year0: number;
  /** Pixels per year. */
  scale: number;
  /** Boxes of the people, by personKey(). */
  persons: Map<string, PersonBox>;
  /** Vertical position of the family (marriage) box in a node, by node id. */
  families: Map<string, number>;
}

/** The same person can appear in the chart more than once, in different generations. */
export function personKey(indiId: string, generation: number | undefined) {
  return `${indiId}:${generation ?? 0}`;
}

/** Returns the date (or the middle of a date range) as a fractional year. */
export function toYear(date: DateOrRange | null | undefined): number | null {
  if (!date) {
    return null;
  }
  const single = (d?: {year?: number; month?: number; day?: number}) => {
    if (!d?.year) {
      return null;
    }
    if (!d.month) {
      return d.year + 0.5;
    }
    return d.year + (d.month - 1 + (d.day ? (d.day - 0.5) / 31 : 0.5)) / 12;
  };
  if (date.date) {
    return single(date.date);
  }
  if (date.dateRange) {
    const from = single(date.dateRange.from);
    const to = single(date.dateRange.to);
    if (from !== null && to !== null) {
      return (from + to) / 2;
    }
    return from ?? to;
  }
  return null;
}

function overlaps(a0: number, a1: number, b0: number, b1: number, gap = 0) {
  return a0 < b1 + gap && b0 < a1 + gap;
}

function entries(n: LayoutNode): TreeEntry[] {
  return [n.data.indi, n.data.spouse].filter((e): e is TreeEntry => !!e);
}

/** Horizontal offset of the person boxes in a node, as in DetailedRenderer. */
function famXOffset(data: TreeNode) {
  return data.family ? Math.max(-getFamPositionVertical(data), 0) : 0;
}

/**
 * Places the boxes in time:
 * - the top of each person's box is at the person's birth year and its height
 *   shows the lifespan (until today for people who may be living; only the
 *   text height if the death is unknown),
 * - the marriage box is at the year of the marriage,
 * - boxes without dates are placed relative to the nearest dated box,
 *   GENERATION_YEARS per generation.
 * Because parents and children live at the same time, their boxes cannot be
 * above each other. Overlapping boxes are moved to the right, keeping the
 * left-to-right order of topola's layout.
 */
export function placeInTime(
  nodes: LayoutNode[],
  dates: (indiId: string) => PersonDates,
  marriageYear: (famId: string) => number | null = () => null,
  now = new Date().getFullYear(),
  scale = PIXELS_PER_YEAR,
): TimelineLayout {
  const gen = (n: LayoutNode) => n.data.generation ?? 0;
  const width = (n: LayoutNode) => n.data.width ?? 0;

  // 1. Year of each node: the earliest known birth in it.
  const nodeYear = new Map<LayoutNode, number>();
  for (const n of nodes) {
    const known = entries(n)
      .map((e) => dates(e.id).birth)
      .filter((y): y is number => y !== null);
    if (known.length) {
      nodeYear.set(n, Math.min(...known));
    }
  }

  // 2. Estimate the rest from the nearest dated node (breadth-first search).
  const neighbours = new Map<LayoutNode, LayoutNode[]>();
  const link = (a: LayoutNode, b: LayoutNode) =>
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  const inChart = new Set(nodes);
  for (const n of nodes) {
    if (n.parent && inChart.has(n.parent)) {
      link(n, n.parent);
      link(n.parent, n);
    }
  }
  const queue = nodes.filter((n) => nodeYear.has(n));
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    const y = nodeYear.get(n) ?? 0;
    for (const m of neighbours.get(n) ?? []) {
      if (!nodeYear.has(m)) {
        nodeYear.set(m, y + (gen(m) - gen(n)) * GENERATION_YEARS);
        queue.push(m);
      }
    }
  }
  for (const n of nodes) {
    if (!nodeYear.has(n)) {
      nodeYear.set(n, gen(n) * GENERATION_YEARS);
    }
  }

  // 3. Boxes of the people and the family box inside each node.
  const persons = new Map<string, PersonBox>();
  const families = new Map<string, number>();
  const extent = new Map<LayoutNode, {top: number; height: number}>();
  const year0 = min(nodes, (n) => nodeYear.get(n)) ?? 0;
  for (const n of nodes) {
    const ny = nodeYear.get(n) ?? 0;
    let bottom = 0;
    let headerBottom = 0;
    for (const e of entries(n)) {
      const d = dates(e.id);
      const year = d.birth ?? ny;
      const offset = (year - ny) * scale;
      const end = d.death ?? (d.living ? now + 0.5 : null);
      const height =
        end !== null && end > year
          ? Math.max(d.headerHeight, (end - year) * scale)
          : d.headerHeight;
      persons.set(personKey(e.id, n.data.generation), {
        offset,
        height,
        year,
        estimated: d.birth === null,
      });
      bottom = Math.max(bottom, offset + height);
      headerBottom = Math.max(headerBottom, offset + d.headerHeight);
    }
    const fam = n.data.family;
    if (fam && (fam.height ?? 0) > 0) {
      const m = marriageYear(fam.id);
      const famY = Math.max(headerBottom, m !== null ? (m - ny) * scale : 0);
      families.set(n.data.id, famY);
      bottom = Math.max(bottom, famY + (fam.height ?? 0));
    }
    extent.set(n, {top: (ny - year0) * scale, height: bottom});
  }

  const left0 = (n: LayoutNode) => n.x - width(n) / 2;
  const noExtent = {top: 0, height: 0};
  const overlapsInTime = (a: LayoutNode, b: LayoutNode) => {
    const ea = extent.get(a) ?? noExtent;
    const eb = extent.get(b) ?? noExtent;
    return overlaps(
      ea.top,
      ea.top + ea.height,
      eb.top,
      eb.top + eb.height,
      MIN_BOX_GAP,
    );
  };

  // 4. If the parents' box reaches down to the time of their children, put all
  //    the children on the right side of the parents instead of centering them
  //    below, so that the line to the children does not run behind other boxes.
  //    The branches on the right of the parents are moved to start after the
  //    children, so that the line to the children does not cross them either.
  const kids = new Map<LayoutNode, LayoutNode[]>();
  for (const n of nodes) {
    const p = n.parent;
    if (p && inChart.has(p) && gen(n) > gen(p)) {
      kids.set(p, [...(kids.get(p) ?? []), n]);
    }
  }
  const descendantTree = new Set([
    ...kids.keys(),
    ...[...kids.values()].flat(),
  ]);
  const subtree = (n: LayoutNode): LayoutNode[] => [
    n,
    ...(kids.get(n) ?? []).flatMap(subtree),
  ];
  const parentsTopDown = [...kids.keys()].sort(
    (a, b) => gen(a) - gen(b) || left0(a) - left0(b),
  );
  for (const p of parentsTopDown) {
    const children = kids.get(p) ?? [];
    if (!children.some((c) => overlapsInTime(p, c))) {
      continue;
    }
    const delta =
      left0(p) + width(p) + H_SPACING - Math.min(...children.map(left0));
    if (delta <= 0) {
      continue;
    }
    const moved = new Set(children.flatMap(subtree));
    // The parents and their own ancestors stay where they are.
    const fixed = new Set<LayoutNode>();
    for (let a: LayoutNode | null = p; a && descendantTree.has(a); ) {
      fixed.add(a);
      a = a.parent && gen(a.parent) < gen(a) ? a.parent : null;
    }
    const pLeft = left0(p);
    const onTheRight = [...descendantTree].filter(
      (n) => !moved.has(n) && !fixed.has(n) && left0(n) > pLeft,
    );
    for (const n of moved) {
      n.x += delta;
    }
    if (onTheRight.length) {
      const childrenRight = Math.max(
        ...children.map((c) => left0(c) + width(c)),
      );
      const rightDelta = Math.max(
        delta,
        childrenRight + H_SPACING - Math.min(...onTheRight.map(left0)),
      );
      for (const n of onTheRight) {
        n.x += rightDelta;
      }
    }
  }

  // 5. Move overlapping boxes to the right, keeping the order.
  const order = [...nodes].sort(
    (a, b) => left0(a) - left0(b) || gen(a) - gen(b),
  );
  const left = new Map<LayoutNode, number>();
  const placed: LayoutNode[] = [];
  let shift = 0;
  for (const n of order) {
    const e = extent.get(n) ?? {top: 0, height: 0};
    let l = left0(n) + shift;
    let moved = true;
    while (moved) {
      moved = false;
      for (const m of placed) {
        const em = extent.get(m) ?? {top: 0, height: 0};
        const lm = left.get(m) ?? 0;
        if (
          overlaps(l, l + width(n), lm, lm + width(m), H_SPACING) &&
          overlaps(
            e.top,
            e.top + e.height,
            em.top,
            em.top + em.height,
            MIN_BOX_GAP,
          )
        ) {
          l = lm + width(m) + H_SPACING;
          moved = true;
        }
      }
    }
    shift = l - left0(n);
    left.set(n, l);
    placed.push(n);
  }

  for (const n of nodes) {
    const e = extent.get(n) ?? {top: 0, height: 0};
    n.data.height = e.height;
    n.y = e.top + e.height / 2;
    n.x = (left.get(n) ?? 0) + width(n) / 2;
    for (const entry of entries(n)) {
      entry.height = persons.get(
        personKey(entry.id, n.data.generation),
      )?.height;
    }
  }
  return {year0, scale, persons, families};
}

/** Length of the short vertical line from the family line to a child's box. */
const LINK_DROP = 12;

/** Height of the family line needed above the given child's box. */
export function busYAbove(box: {y0: number}) {
  return box.y0 - LINK_DROP;
}

/**
 * Path from the family (sx, sy) to a child's box, as in topola's charts:
 * a vertical line from the family to busY, the family's horizontal line above
 * the children's boxes (LINK_DROP above the earliest born child), along it to
 * the middle of the child's box and a short vertical line down to its top.
 * All children of a family share the vertical line and the horizontal line,
 * so they are drawn as one line.
 */
export function familyLinkPath(
  sx: number,
  sy: number,
  busY: number,
  box: {x0: number; x1: number; y0: number},
): string {
  if (sx >= box.x0 && sx <= box.x1) {
    return `M ${sx} ${sy} L ${sx} ${box.y0}`;
  }
  const dropX = (box.x0 + box.x1) / 2;
  return `M ${sx} ${sy} L ${sx} ${busY} L ${dropX} ${busY} L ${dropX} ${box.y0}`;
}

interface IndiDatum {
  indi: TreeEntry;
  generation?: number;
  xOffset: number;
}

/**
 * Wraps topola's renderer: draws the boxes the same way, then moves each
 * person's box to the person's birth year and the marriage box to the year of
 * the marriage.
 */
class TimelineRenderer implements Renderer {
  layout?: TimelineLayout;

  constructor(
    readonly inner: Renderer,
    private readonly animate: boolean,
  ) {}

  headerHeight(entry: TreeEntry): number {
    const inner = this.inner as {
      getPreferredIndiSize?: (id: string) => [number, number];
    };
    return inner.getPreferredIndiSize?.(entry.id)[1] ?? entry.height ?? 0;
  }

  render(enter: TreeNodeSelection, update: TreeNodeSelection): void {
    this.inner.render(enter, update);
    const layout = this.layout;
    if (!layout) {
      return;
    }
    const all = enter.merge(update);
    const transition = <E extends BaseType, D>(
      s: Selection<E, D, BaseType, unknown>,
    ) =>
      this.animate
        ? s
            .transition()
            .delay(ANIMATION_DELAY_MS)
            .duration(ANIMATION_DURATION_MS)
        : s;
    transition(all.selectAll<SVGGElement, IndiDatum>('g.indi')).attr(
      'transform',
      (d) => {
        const box = layout.persons.get(personKey(d.indi.id, d.generation));
        return `translate(${d.xOffset}, ${box?.offset ?? 0})`;
      },
    );
    transition(all.selectAll<SVGGElement, LayoutNode>('g.family')).attr(
      'transform',
      (node) =>
        `translate(${Math.max(getFamPositionVertical(node.data), 0)}, ${
          layout.families.get(node.data.id) ?? 0
        })`,
    );
  }

  getCss() {
    return this.inner.getCss();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateNodes(nodes: any) {
    this.inner.updateNodes(nodes);
  }
  getFamilyAnchor(node: TreeNode) {
    return this.inner.getFamilyAnchor(node);
  }
  getIndiAnchor(node: TreeNode) {
    return this.inner.getIndiAnchor(node);
  }
  getSpouseAnchor(node: TreeNode) {
    return this.inner.getSpouseAnchor(node);
  }
}

/**
 * Hourglass chart (ancestors above, descendants below) on a vertical time
 * axis: each box starts at the birth of the person and its height shows the
 * lifespan.
 */
export class TimelineHourglassChart implements Chart {
  readonly options: ChartOptions;
  readonly util: ChartUtil;
  private readonly renderer: TimelineRenderer;
  private layout?: TimelineLayout;
  /** The start node appears in both halves; the descendant copy is drawn. */
  private start?: {anc: LayoutNode; desc: LayoutNode};

  constructor(options: ChartOptions) {
    this.renderer = new TimelineRenderer(options.renderer, !!options.animate);
    this.options = {...options, renderer: this.renderer};
    this.util = new ChartUtil(this.options);
    // Links are drawn by this class, because they depend on the person boxes.
    this.util.renderLinks = (nodes, svg) =>
      this.renderLinks(nodes as unknown as LayoutNode[], svg);
  }

  private dates = (id: string): PersonDates => {
    const indi = this.options.data.getIndi(id) as IndiDetails | null;
    const birth = toYear(indi?.getBirthDate?.());
    const death = toYear(indi?.getDeathDate?.());
    const now = new Date().getFullYear();
    return {
      birth,
      death,
      living:
        death === null &&
        !indi?.isConfirmedDeath?.() &&
        birth !== null &&
        birth > now - LIVING_CUTOFF_YEARS,
      headerHeight: this.renderer.headerHeight({id}),
    };
  };

  private marriageYear = (id: string): number | null => {
    const fam = this.options.data.getFam(id) as FamDetails | null;
    return toYear(fam?.getMarriageDate?.());
  };

  render(): ChartInfo {
    const ancestorsRoot = getAncestorsTree(this.options);
    const ancestorNodes = this.util.layOutChart(ancestorsRoot, {
      flipVertically: true,
    }) as unknown as LayoutNode[];
    const descendantNodes = layOutDescendants(
      this.options,
    ) as unknown as LayoutNode[];
    // The first ancestor node and descendant node is the start node.
    const [ancStart, descStart] = [ancestorNodes[0], descendantNodes[0]];
    if (ancStart.data.indi?.expander !== undefined && descStart.data.indi) {
      descStart.data.indi.expander = ancStart.data.indi.expander;
    }
    if (ancStart.data.spouse?.expander !== undefined && descStart.data.spouse) {
      descStart.data.spouse.expander = ancStart.data.spouse.expander;
    }
    // slice(1) removes the duplicated start node. Its ancestors still point to
    // it as their parent, so they are linked to the descendant copy for the
    // layout and the copy's position is written back afterwards.
    const nodes = ancestorNodes.slice(1).concat(descendantNodes);
    for (const n of ancestorNodes) {
      if (n.parent === ancStart) n.parent = descStart;
    }
    const layout = placeInTime(nodes, this.dates, this.marriageYear);
    for (const n of ancestorNodes) {
      if (n.parent === descStart) n.parent = ancStart;
    }
    ancStart.x = descStart.x;
    ancStart.y = descStart.y;
    ancStart.data.width = descStart.data.width;
    ancStart.data.height = descStart.data.height;
    this.layout = layout;
    this.renderer.layout = layout;
    this.start = {anc: ancStart, desc: descStart};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const animationPromise = this.util.renderChart(nodes as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = getChartInfo(nodes as any);
    // Room for the year labels.
    info.size[0] += 2 * AXIS_WIDTH;
    info.origin[0] += AXIS_WIDTH;
    this.util.updateSvgDimensions(info);
    this.renderAxis(nodes, layout, info);
    // Redraw the axis when the historical events have been loaded.
    setTimelineEventsListener(() => this.renderAxis(nodes, layout, info));
    loadTimelineEvents();
    return Object.assign(info, {animationPromise});
  }

  /** Position and size of a person's box in chart coordinates. */
  private personBox(n: LayoutNode, entry: TreeEntry) {
    const box = this.layout?.persons.get(
      personKey(entry.id, n.data.generation),
    );
    const isSpouse =
      n.data.spouse?.id === entry.id && n.data.indi?.id !== entry.id;
    const x0 =
      n.x -
      (n.data.width ?? 0) / 2 +
      famXOffset(n.data) +
      (isSpouse && n.data.indi ? (n.data.indi.width ?? 0) : 0);
    const y0 = n.y - (n.data.height ?? 0) / 2 + (box?.offset ?? 0);
    return {x0, x1: x0 + (entry.width ?? 0), y0};
  }

  /** Path from the parents' node to the child's box. */
  private linkPath(upper: LayoutNode, lower: LayoutNode): string {
    const {sx, sy, box} = this.linkEnds(upper, lower);
    if (!box) {
      return `M ${sx} ${sy}`;
    }
    return familyLinkPath(sx, sy, this.busY.get(upper) ?? busYAbove(box), box);
  }

  /** Height of the horizontal line of each family, by the upper node. */
  private busY = new Map<LayoutNode, number>();

  /** Computes the height of the horizontal line of each family. */
  private updateBusY(links: LayoutNode[]) {
    this.busY = new Map();
    for (const node of links) {
      const pair = this.upperAndLower(node);
      if (!pair) {
        continue;
      }
      const {box} = this.linkEnds(pair[0], pair[1]);
      if (box) {
        const y = busYAbove(box);
        this.busY.set(pair[0], Math.min(this.busY.get(pair[0]) ?? y, y));
      }
    }
  }

  /** The parents' node and the child's node of a link. */
  private upperAndLower(node: LayoutNode): [LayoutNode, LayoutNode] | null {
    const parent = node.parent;
    if (!parent) {
      return null;
    }
    return (parent.data.generation ?? 0) < (node.data.generation ?? 0)
      ? [parent, node]
      : [node, parent];
  }

  /** Start point of a link at the family and the box of the child. */
  private linkEnds(
    upper: LayoutNode,
    lower: LayoutNode,
  ): {sx: number; sy: number; box?: {x0: number; x1: number; y0: number}} {
    const top = upper.y - (upper.data.height ?? 0) / 2;
    const left = upper.x - (upper.data.width ?? 0) / 2;
    const fam = upper.data.family;
    const famY = this.layout?.families.get(upper.data.id);
    let sx: number;
    let sy: number;
    if (fam && famY !== undefined) {
      sx =
        left +
        Math.max(getFamPositionVertical(upper.data), 0) +
        (fam.width ?? 0) / 2;
      sy = top + famY + (fam.height ?? 0) / 2;
    } else {
      const i = upper.data.indi;
      sx =
        left +
        (i && upper.data.spouse ? (i.width ?? 0) : (upper.data.width ?? 0) / 2);
      sy = top + 20;
    }
    const target =
      upper.data.id === lower.data.spouseParentNodeId
        ? lower.data.spouse
        : lower.data.indi;
    if (!target) {
      return {sx, sy};
    }
    // Geometry of the start node is that of its drawn (descendant) copy.
    const drawn = lower === this.start?.anc ? this.start.desc : lower;
    const entry =
      [drawn.data.indi, drawn.data.spouse].find((e) => e?.id === target.id) ??
      target;
    return {sx, sy, box: this.personBox(drawn, entry)};
  }

  private link(node: LayoutNode): string {
    const parent = node.parent;
    if (node.data.additionalMarriage && parent?.children) {
      const i = parent.children.findIndex((n) => n.data.id === node.data.id);
      const sibling = parent.children[i - 1];
      if (sibling?.data.indi && node.data.indi) {
        const a = this.personBox(node, node.data.indi);
        const b = this.personBox(sibling, sibling.data.indi);
        return `M ${(a.x0 + a.x1) / 2} ${a.y0 + 20} L ${(b.x0 + b.x1) / 2} ${b.y0 + 20}`;
      }
    }
    const pair = this.upperAndLower(node);
    return pair ? this.linkPath(pair[0], pair[1]) : '';
  }

  private linkClass(node: LayoutNode): string {
    if (node.data.additionalMarriage) {
      return 'link additional-marriage';
    }
    const parent = node.parent;
    if (!parent) {
      return 'link';
    }
    const [child, upper] =
      (node.data.generation ?? 0) > (parent.data.generation ?? 0)
        ? [node, parent]
        : [parent, node];
    const childId =
      upper.data.id === child.data.spouseParentNodeId
        ? child.data.spouse?.id
        : child.data.indi?.id;
    const indi = childId
      ? (this.options.data.getIndi(childId) as IndiDetails | null)
      : null;
    const confidence = indi?.getParentLinkConfidence?.();
    return confidence === null || confidence === undefined
      ? 'link'
      : `link confidence${confidence}`;
  }

  /** Same behavior as topola's LinkRenderer, with time-based paths. */
  private renderLinks(
    nodes: LayoutNode[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svg: Selection<BaseType, any, BaseType, any>,
  ): Promise<void> {
    const links = nodes.filter((n) => !!n.parent || n.data.additionalMarriage);
    this.updateBusY(links);
    const bound = svg
      .select('g')
      .selectAll<SVGPathElement, LayoutNode>('path.link')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .data(links, (n) => linkId(n as any));
    const entered = bound
      .enter()
      .insert('path', 'g')
      .attr('class', (n) => this.linkClass(n))
      .attr('d', (n) => this.link(n));
    bound.attr('class', (n) => this.linkClass(n));
    if (!this.options.animate) {
      bound.attr('d', (n) => this.link(n));
      bound.exit().remove();
      return Promise.resolve();
    }
    entered
      .style('opacity', 0)
      .transition()
      .delay(2 * HIDE_TIME_MS + MOVE_TIME_MS)
      .duration(0)
      .style('opacity', 1);
    bound.exit().remove();
    return bound
      .transition()
      .delay(HIDE_TIME_MS)
      .duration(MOVE_TIME_MS)
      .attr('d', (n) => this.link(n))
      .end()
      .catch(() => undefined);
  }

  /**
   * Draws the decade lines and year labels behind the boxes. They are put in a
   * nested <svg> element without <g> elements, because topola renders into
   * the first <g> it finds in the chart.
   */
  private renderAxis(
    nodes: LayoutNode[],
    layout: TimelineLayout,
    info: {size: [number, number]; origin: [number, number]},
  ) {
    const chart = select(this.options.svgSelector);
    const old = chart.select<SVGSVGElement>('svg.timeline-axis');
    const axis = old.empty()
      ? chart.insert('svg', ':first-child').attr('class', 'timeline-axis')
      : old;
    axis.selectAll('*').remove();
    // The nested <svg> covers exactly the chart area; its viewBox maps the
    // layout coordinates (start node at 0, 0) onto it, so nothing is clipped.
    const [w, h] = info.size;
    const viewBox = `${-info.origin[0]} ${-info.origin[1]} ${w} ${h}`;
    axis.attr('x', 0).attr('y', 0);
    if (this.options.animate && !old.empty()) {
      axis
        .transition()
        .delay(HIDE_TIME_MS)
        .duration(MOVE_TIME_MS)
        .attr('width', w)
        .attr('height', h)
        .attr('viewBox', viewBox);
    } else {
      axis.attr('width', w).attr('height', h).attr('viewBox', viewBox);
    }

    const yOf = (year: number) => (year - layout.year0) * layout.scale;
    const yearAt = (y: number) => layout.year0 + y / layout.scale;
    const top = min(nodes, (n) => n.y - (n.data.height ?? 0) / 2) ?? 0;
    const bottom = max(nodes, (n) => n.y + (n.data.height ?? 0) / 2) ?? 0;
    const left = -info.origin[0];
    const right = info.size[0] - info.origin[0];
    const step =
      layout.scale * 10 >= 24 ? 10 : layout.scale * 25 >= 24 ? 25 : 50;
    const first = Math.ceil(yearAt(top - 20) / step) * step;
    const last = Math.floor(yearAt(bottom + 20) / step) * step;
    const drawEventLabels = this.renderEvents(axis, {
      fromYear: yearAt(top - 20),
      toYear: yearAt(bottom + 20),
      x0: left + AXIS_WIDTH,
      x1: right - AXIS_WIDTH,
      yOf,
      boxes: nodes.map((n) => ({
        x0: n.x - (n.data.width ?? 0) / 2,
        x1: n.x + (n.data.width ?? 0) / 2,
        y0: n.y - (n.data.height ?? 0) / 2,
        y1: n.y + (n.data.height ?? 0) / 2,
      })),
    });
    for (let year = first; year <= last; year += step) {
      const y = yOf(year);
      const major = year % 50 === 0;
      axis
        .append('line')
        .attr('x1', left + AXIS_WIDTH - 4)
        .attr('x2', right - AXIS_WIDTH + 4)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', major ? '#d2d2d2' : '#e8e8e8')
        .attr('stroke-width', 1);
      for (const [x, anchor] of [
        [left + AXIS_WIDTH - 8, 'end'],
        [right - AXIS_WIDTH + 8, 'start'],
      ] as const) {
        axis
          .append('text')
          .attr('x', x)
          .attr('y', y + 4)
          .attr('text-anchor', anchor)
          .attr('font-family', 'sans-serif')
          .attr('font-size', 11)
          .attr('font-weight', major ? 'bold' : 'normal')
          .attr('fill', major ? '#555' : '#999')
          .text(year);
      }
    }
    drawEventLabels();
  }

  /**
   * Draws the historical events in the visible time range: periods as
   * transparent bands, short events as lines, with their names repeated
   * across the width of the chart.
   */
  private renderEvents(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    axis: Selection<SVGSVGElement, any, BaseType, any>,
    range: {
      fromYear: number;
      toYear: number;
      x0: number;
      x1: number;
      yOf: (year: number) => number;
      /** The boxes of the chart, the names are put next to them. */
      boxes: Array<{x0: number; x1: number; y0: number; y1: number}>;
    },
  ): () => void {
    const {x0, x1, yOf} = range;
    const visible = getTimelineEvents().filter(
      (e) => e.to > range.fromYear && e.from < range.toYear,
    );
    const labels: Array<{
      x: number;
      y: number;
      width: number;
      text: string;
      color: string;
    }> = [];
    for (const event of visible) {
      const color = event.color ?? DEFAULT_EVENT_COLOR;
      const y0 = yOf(Math.max(event.from, range.fromYear));
      const y1 = yOf(Math.min(event.to, range.toYear));
      const isBand = y1 - y0 >= MIN_EVENT_BAND_HEIGHT;
      if (isBand) {
        axis
          .append('rect')
          .attr('class', 'timeline-event')
          .attr('x', x0)
          .attr('y', y0)
          .attr('width', Math.max(0, x1 - x0))
          .attr('height', y1 - y0)
          .attr('fill', color)
          .attr('fill-opacity', 0.1);
        for (const y of [y0, y1]) {
          axis
            .append('line')
            .attr('x1', x0)
            .attr('x2', x1)
            .attr('y1', y)
            .attr('y2', y)
            .attr('stroke', color)
            .attr('stroke-opacity', 0.35)
            .attr('stroke-width', 1);
        }
      } else {
        axis
          .append('line')
          .attr('class', 'timeline-event')
          .attr('x1', x0)
          .attr('x2', x1)
          .attr('y1', y0)
          .attr('y2', y0)
          .attr('stroke', color)
          .attr('stroke-opacity', 0.7)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6 4');
      }
      // Inside the top of a band, above a line.
      const labelY = isBand ? y0 + 12 : y0 - 4;
      const labelTop = labelY - EVENT_LABEL_HEIGHT + 2;
      const labelBottom = labelY + 2;
      const labelWidth = event.label.length * EVENT_LABEL_CHAR_WIDTH;
      // Places that are not free: boxes and labels at the height of the label.
      const occupied: Array<[number, number]> = [
        ...range.boxes
          .filter((b) => b.y0 < labelBottom && b.y1 > labelTop)
          .map((b): [number, number] => [b.x0, b.x1]),
        ...labels
          .filter(
            (l) => l.y - EVENT_LABEL_HEIGHT < labelBottom && l.y > labelTop,
          )
          .map((l): [number, number] => [l.x, l.x + l.width]),
      ];
      // The name is repeated across the chart in the free places.
      let x: number | null = x0 + 6;
      while (x !== null) {
        x = findFreeX(x, labelWidth, x1, occupied);
        if (x === null) {
          break;
        }
        labels.push({
          x,
          y: labelY,
          width: labelWidth,
          text: event.label,
          color,
        });
        occupied.push([x, x + labelWidth]);
        x += labelWidth + EVENT_LABEL_REPEAT;
      }
    }

    // Drawn last, on top of the lines, with a white outline to stay readable.
    return () => {
      for (const label of labels) {
        axis
          .append('text')
          .attr('class', 'timeline-event-label')
          .attr('x', label.x)
          .attr('y', label.y)
          .attr('font-family', 'sans-serif')
          .attr('font-size', 11)
          .attr('font-weight', 'bold')
          .attr('fill', label.color)
          .attr('stroke', 'white')
          .attr('stroke-width', 3)
          .attr('stroke-linejoin', 'round')
          .attr('paint-order', 'stroke')
          .text(label.text);
      }
    };
  }
}

/**
 * Returns the first position from `x` where a label of the given width fits
 * between the occupied intervals, or null if it does not fit before `maxX`.
 */
export function findFreeX(
  x: number,
  width: number,
  maxX: number,
  occupied: Array<[number, number]>,
  padding = 6,
): number | null {
  let pos = x;
  let moved = true;
  while (moved) {
    moved = false;
    for (const [a, b] of occupied) {
      if (pos < b + padding && pos + width > a - padding) {
        pos = b + padding;
        moved = true;
      }
    }
  }
  return pos + width <= maxX ? pos : null;
}
