import {afterEach, beforeEach, describe, expect, it} from '@jest/globals';
import {
  DEFAULT_TIMELINE_EVENTS_URL,
  getTimelineEventsUrl,
  parseEventDate,
  parseTimelineEvents,
} from './timeline_events';

describe('parseEventDate', () => {
  it('parses years as the start or the end of the year', () => {
    expect(parseEventDate(1914, false)).toBe(1914);
    expect(parseEventDate(1914, true)).toBe(1915);
    expect(parseEventDate('1914', false)).toBe(1914);
  });

  it('parses months and days', () => {
    expect(parseEventDate('1914-07', false)).toBeCloseTo(1914 + 6 / 12);
    expect(parseEventDate('1914-07', true)).toBeCloseTo(1914 + 7 / 12);
    expect(parseEventDate('1914-07-28', false)).toBeCloseTo(
      1914 + (6 + 27 / 31) / 12,
    );
    expect(parseEventDate('1914-07-28', true)).toBeCloseTo(
      1914 + (6 + 28 / 31) / 12,
    );
  });

  it('rejects invalid dates', () => {
    expect(parseEventDate('1914-13', false)).toBeNull();
    expect(parseEventDate('1914-01-32', false)).toBeNull();
    expect(parseEventDate('July 1914', false)).toBeNull();
    expect(parseEventDate(undefined, false)).toBeNull();
    expect(parseEventDate({}, false)).toBeNull();
  });
});

describe('parseTimelineEvents', () => {
  it('parses periods and single events', () => {
    expect(
      parseTimelineEvents([
        {label: 'WW1', from: 1914, to: 1918, color: '#6d4c41'},
        {label: 'Event', from: '1867'},
      ]),
    ).toEqual([
      {label: 'WW1', from: 1914, to: 1919, color: '#6d4c41'},
      {label: 'Event', from: 1867, to: 1868, color: undefined},
    ]);
  });

  it('skips invalid entries', () => {
    expect(
      parseTimelineEvents([
        null,
        'text',
        {from: 1914},
        {label: '', from: 1914},
        {label: 'No date'},
        {label: 'Bad date', from: 'soon'},
        {label: 'Reversed', from: 1920, to: 1910},
        {label: 'Valid', from: 1900},
      ]).map((e) => e.label),
    ).toEqual(['Valid']);
  });

  it('ignores colors that are not plain color values', () => {
    const [event] = parseTimelineEvents([
      {label: 'X', from: 1900, color: 'url(javascript:alert(1))'},
    ]);
    expect(event.color).toBeUndefined();
  });

  it('returns no events for invalid files', () => {
    expect(parseTimelineEvents({label: 'X', from: 1900})).toEqual([]);
    expect(parseTimelineEvents(null)).toEqual([]);
  });
});

describe('getTimelineEventsUrl', () => {
  let metaContent: string | null = null;

  beforeEach(() => {
    metaContent = null;
    Object.defineProperty(global, 'document', {
      value: {
        querySelector: (selector: string) =>
          selector === 'meta[name="topola-timeline-events-url"]' &&
          metaContent !== null
            ? {getAttribute: () => metaContent}
            : null,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, 'document', {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it('uses the default file without configuration', () => {
    expect(getTimelineEventsUrl()).toBe(DEFAULT_TIMELINE_EVENTS_URL);
  });

  it('uses the URL configured on the server', () => {
    metaContent = 'events/my-events.json';
    expect(getTimelineEventsUrl()).toBe('events/my-events.json');
  });

  it('ignores an empty value and the raw template expression', () => {
    metaContent = '';
    expect(getTimelineEventsUrl()).toBe(DEFAULT_TIMELINE_EVENTS_URL);
    metaContent = '{{ env `TIMELINE_EVENTS_URL` | html }}';
    expect(getTimelineEventsUrl()).toBe(DEFAULT_TIMELINE_EVENTS_URL);
  });
});
