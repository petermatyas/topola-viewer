import {EventCategory} from './places';

/** Marker colors by event category. */
export const CATEGORY_COLORS = new Map<EventCategory, string>([
  [EventCategory.BIRTH, '#2e9e44'],
  [EventCategory.MARRIAGE, '#d6336c'],
  [EventCategory.RESIDENCE, '#1c7ed6'],
  [EventCategory.DEATH, '#495057'],
  [EventCategory.OTHER, '#e8590c'],
]);

/**
 * Line colors. The order follows the hues of the "color by generation" chart
 * option, but saturated so that lines are visible on the map.
 */
export const LINE_COLORS = [
  '#e0a800',
  '#74b816',
  '#2b8a3e',
  '#0ca678',
  '#1098ad',
  '#1c7ed6',
  '#4263eb',
  '#7048e8',
  '#ae3ec9',
  '#d6336c',
  '#e03131',
  '#f76707',
];

export function lineColor(index: number) {
  return LINE_COLORS[index % LINE_COLORS.length];
}
