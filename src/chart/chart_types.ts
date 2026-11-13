import {
  CircleRenderer,
  DetailedRenderer,
  FancyChart,
  HourglassChart,
  IndiInfo,
  JsonGedcomData,
  RelativesChart,
  ChartColors as TopolaChartColors,
} from 'topola';
import {ChartColors, Ids, PlaceDisplay, Sex} from '../sidepanel/config/config';
import {TimelineHourglassChart} from './timeline_hourglass_chart';

/** Supported chart types. */
export enum ChartType {
  Hourglass,
  Relatives,
  Donatso,
  Fancy,
  /** Hourglass chart on a time axis: boxes placed at birth years. */
  Timeline,
  /** Hourglass chart next to a map of the places of the individuals. */
  Map,
}

export interface ChartProps {
  data: JsonGedcomData;
  selection: IndiInfo;
  chartType: ChartType;
  onSelection: (indiInfo: IndiInfo) => void;
  onDetailSelection: (indiInfo: IndiInfo) => void;
  freezeAnimation?: boolean;
  colors?: ChartColors;
  hideIds?: Ids;
  hideSex?: Sex;
  placeDisplay?: PlaceDisplay;
  placeCount?: number;
  /** Max. number of ancestor generations shown; undefined means all. */
  ancestorGenerations?: number;
  /** Max. number of descendant generations shown; undefined means all. */
  descendantGenerations?: number;
  /** Called once after the initial D3 layout and SVG render completes. */
  onFirstRender?: () => void;
}

export const chartColors = new Map<ChartColors, TopolaChartColors>([
  [ChartColors.NO_COLOR, TopolaChartColors.NO_COLOR],
  [ChartColors.COLOR_BY_GENERATION, TopolaChartColors.COLOR_BY_GENERATION],
  [ChartColors.COLOR_BY_SEX, TopolaChartColors.COLOR_BY_SEX],
]);

export function getChartType(chartType: ChartType) {
  switch (chartType) {
    case ChartType.Hourglass:
      return HourglassChart;
    case ChartType.Timeline:
      return TimelineHourglassChart;
    case ChartType.Relatives:
      return RelativesChart;
    case ChartType.Fancy:
      return FancyChart;
    default:
      // Fall back to hourglass chart.
      return HourglassChart;
  }
}

export function getRendererType(chartType: ChartType) {
  switch (chartType) {
    case ChartType.Fancy:
      return CircleRenderer;
    default:
      // Use DetailedRenderer by default.
      return DetailedRenderer;
  }
}
