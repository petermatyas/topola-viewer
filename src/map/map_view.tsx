import 'leaflet.markercluster/dist/MarkerCluster.css';
import L from './leaflet_setup';
import './map.css';

import {useEffect, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {IndiInfo, JsonFam, JsonIndi} from 'topola';
import {Config} from '../sidepanel/config/config';
import {tagMessage} from '../sidepanel/details/translated-tag';
import {idToFamMap, idToIndiMap, TopolaData} from '../util/gedcom_util';
import {CATEGORY_COLORS, lineColor} from './map_colors';
import {MapFilterBar} from './map_filter_bar';
import {
  filterEvents,
  MapFilters,
  missingSummary,
  MovementMode,
  selectPeople,
  yearRange,
} from './map_filters';
import {indiName, MissingPlaces} from './missing_places';
import {
  ancestorSegments,
  immediateFamily,
  personalSegments,
  Segment,
} from './movements';
import {
  ALL_EVENT_CATEGORIES,
  EventCategory,
  hasCoordinates,
  PlaceData,
  PlacedEvent,
} from './places';

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
/** Number of animation steps when playing over the whole time range. */
const PLAYBACK_STEPS = 120;
const PLAYBACK_INTERVAL_MS = 100;

interface Props {
  data: TopolaData;
  placeData: PlaceData;
  selection: IndiInfo;
  config: Config;
  filters: MapFilters;
  onFiltersChange: (filters: MapFilters) => void;
  onSelection: (indiInfo: IndiInfo) => void;
  onDetailSelection: (indiInfo: IndiInfo) => void;
}

interface CountedMarkerOptions extends L.MarkerOptions {
  eventCount: number;
}

/** The most frequent category of the events, used as the marker color. */
function mainCategory(events: PlacedEvent[]): EventCategory {
  const counts = new Map<EventCategory, number>();
  events.forEach((e) =>
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1),
  );
  return ALL_EVENT_CATEGORIES.reduce((best, category) =>
    (counts.get(category) ?? 0) > (counts.get(best) ?? 0) ? category : best,
  );
}

function markerSize(count: number) {
  return Math.min(40, Math.round(14 + 4 * Math.sqrt(count)));
}

/** Screen angle (degrees, clockwise from east) of the line between two points. */
function bearing(from: L.LatLngExpression, to: L.LatLngExpression) {
  const a = L.CRS.EPSG3857.project(L.latLng(from));
  const b = L.CRS.EPSG3857.project(L.latLng(to));
  return (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
}

/** Removes duplicate segments (e.g. both parents born at the same place). */
function uniqueSegments(segments: Segment[]) {
  const seen = new Set<string>();
  return segments.filter((s) => {
    const key = `${s.fromKey}|${s.toKey}|${s.colorIndex}|${s.approximate}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function computeSegments(
  mode: MovementMode,
  selectionId: string,
  indiMap: Map<string, JsonIndi>,
  famMap: Map<string, JsonFam>,
  placeData: PlaceData,
  config: Config,
): Segment[] {
  switch (mode) {
    case MovementMode.ANCESTORS:
      return ancestorSegments(
        selectionId,
        indiMap,
        famMap,
        placeData.eventsByIndi,
        placeData.places,
        config.ancestorGenerations,
      );
    case MovementMode.FAMILY:
      return immediateFamily(selectionId, indiMap, famMap).flatMap((id, i) =>
        personalSegments(id, placeData.eventsByIndi, placeData.places, i),
      );
    case MovementMode.PERSON:
      return personalSegments(
        selectionId,
        placeData.eventsByIndi,
        placeData.places,
        0,
      );
    default:
      return [];
  }
}

/** Map of the places of the individuals, with filters and movement lines. */
export function MapView(props: Props) {
  const intl = useIntl();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>();
  const markersRef = useRef<L.MarkerClusterGroup>();
  const linesRef = useRef<L.LayerGroup>();
  const fittedRef = useRef(false);
  // Keep the latest callbacks for event handlers created in effects.
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  const [playing, setPlaying] = useState(false);
  const [playYear, setPlayYear] = useState<number>();
  const [clustersReady, setClustersReady] = useState(false);

  const indiMap = useMemo(
    () => idToIndiMap(props.data.chartData),
    [props.data],
  );
  const famMap = useMemo(() => idToFamMap(props.data.chartData), [props.data]);
  const range = useMemo(() => yearRange(props.placeData), [props.placeData]);

  const people = useMemo(
    () =>
      selectPeople(
        props.filters,
        {
          selectionId: props.selection.id,
          ancestorGenerations: props.config.ancestorGenerations,
          descendantGenerations: props.config.descendantGenerations,
        },
        indiMap,
        famMap,
      ),
    [
      props.filters,
      props.selection.id,
      props.config.ancestorGenerations,
      props.config.descendantGenerations,
      indiMap,
      famMap,
    ],
  );

  const events = useMemo(
    () => filterEvents(props.placeData, people, props.filters, playYear),
    [props.placeData, people, props.filters, playYear],
  );

  const summary = useMemo(
    () => missingSummary(props.placeData, people),
    [props.placeData, people],
  );

  /** Events grouped by place, only places with coordinates. */
  const eventsByPlace = useMemo(() => {
    const result = new Map<string, PlacedEvent[]>();
    for (const event of events) {
      if (!hasCoordinates(props.placeData.places.get(event.placeKey))) {
        continue;
      }
      const list = result.get(event.placeKey) ?? [];
      list.push(event);
      result.set(event.placeKey, list);
    }
    return result;
  }, [events, props.placeData]);

  const selectedPlaces = useMemo(
    () =>
      new Set(
        (props.placeData.eventsByIndi.get(props.selection.id) ?? [])
          .filter((e) => hasCoordinates(props.placeData.places.get(e.placeKey)))
          .map((e) => e.placeKey),
      ),
    [props.placeData, props.selection.id],
  );

  const segments = useMemo(() => {
    const all = computeSegments(
      props.filters.movements,
      props.selection.id,
      indiMap,
      famMap,
      props.placeData,
      props.config,
    );
    const toYear = playYear ?? props.filters.toYear;
    return uniqueSegments(
      all.filter((s) => {
        if (s.year === undefined) {
          return props.filters.showUndated && playYear === undefined;
        }
        return (
          (props.filters.fromYear === undefined ||
            s.year >= props.filters.fromYear) &&
          (toYear === undefined || s.year <= toYear)
        );
      }),
    );
  }, [
    props.filters,
    props.selection.id,
    props.placeData,
    props.config,
    indiMap,
    famMap,
    playYear,
  ]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const map = L.map(containerRef.current, {
      center: [47.2, 19.4],
      zoom: 6,
      worldCopyJump: true,
    });
    L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || DEFAULT_TILE_URL, {
      maxZoom: 18,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);
    linesRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The cluster plugin extends the global `L`, so it is loaded only after
    // Leaflet has been set up (a static import could be evaluated earlier).
    let cancelled = false;
    import('leaflet.markercluster').then(() => {
      if (cancelled) {
        return;
      }
      markersRef.current = L.markerClusterGroup({
        maxClusterRadius: 30,
        showCoverageOnHover: false,
        iconCreateFunction: (cluster) => {
          const count = cluster
            .getAllChildMarkers()
            .reduce(
              (sum, marker) =>
                sum + (marker.options as CountedMarkerOptions).eventCount,
              0,
            );
          const size = markerSize(count) + 6;
          return L.divIcon({
            html: `<div>${count}</div>`,
            className: 'map-cluster',
            iconSize: [size, size],
          });
        },
      }).addTo(map);
      setClustersReady(true);
    });

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      map.remove();
      mapRef.current = undefined;
      markersRef.current = undefined;
    };
  }, []);

  // Markers.
  useEffect(() => {
    const layer = markersRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();
    const markers: L.Marker[] = [];
    eventsByPlace.forEach((placeEvents, placeKey) => {
      const place = props.placeData.places.get(placeKey);
      if (!hasCoordinates(place)) {
        return;
      }
      const size = markerSize(placeEvents.length);
      const selected = selectedPlaces.has(placeKey);
      const color = CATEGORY_COLORS.get(mainCategory(placeEvents));
      const icon = L.divIcon({
        className: `map-marker${selected ? ' selected' : ''}`,
        html: `<div style="background:${color}">${
          placeEvents.length > 1 ? placeEvents.length : ''
        }</div>`,
        iconSize: [size, size],
      });
      const marker = L.marker([place.lat, place.lon], {
        icon,
        eventCount: placeEvents.length,
        zIndexOffset: selected ? 1000 : 0,
        title: placeKey,
      } as CountedMarkerOptions);
      marker.bindPopup(() => createPopup(placeKey, placeEvents), {
        maxWidth: 320,
      });
      markers.push(marker);
    });
    layer.addLayers(markers);
  }, [eventsByPlace, selectedPlaces, props.placeData, intl, clustersReady]);

  // Movement lines.
  useEffect(() => {
    const layer = linesRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();
    for (const segment of segments) {
      const color = lineColor(segment.colorIndex);
      const indi = indiMap.get(segment.indiId);
      L.polyline([segment.from, segment.to], {
        color,
        weight: 3,
        opacity: 0.85,
        dashArray: segment.approximate ? '6 6' : undefined,
      })
        .bindTooltip(
          `${indiName(indi, segment.indiId)}: ${segment.fromKey} → ${
            segment.toKey
          }${segment.year !== undefined ? ` (${segment.year})` : ''}`,
          {sticky: true},
        )
        .addTo(layer);
      // Arrow head at 70% of the line.
      const at: L.LatLngTuple = [
        segment.from[0] + (segment.to[0] - segment.from[0]) * 0.7,
        segment.from[1] + (segment.to[1] - segment.from[1]) * 0.7,
      ];
      L.marker(at, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'map-arrow',
          html: `<svg viewBox="0 0 12 12" width="14" height="14" style="transform: rotate(${bearing(
            segment.from,
            segment.to,
          )}deg)"><path d="M0,0 L12,6 L0,12 z" fill="${color}"/></svg>`,
          iconSize: [14, 14],
        }),
      }).addTo(layer);
    }
  }, [segments, indiMap]);

  // Zoom to the selected person's places, or to all places initially.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const keys = selectedPlaces.size
      ? [...selectedPlaces]
      : fittedRef.current
        ? []
        : [...eventsByPlace.keys()];
    const points = keys
      .map((key) => props.placeData.places.get(key))
      .filter(hasCoordinates)
      .map((place) => L.latLng(place.lat, place.lon));
    if (!points.length) {
      return;
    }
    fittedRef.current = true;
    map.fitBounds(L.latLngBounds(points), {
      padding: [40, 40],
      maxZoom: 8,
      animate: true,
    });
    // Only react to selection changes, not to every filter change.
  }, [selectedPlaces]);

  // Playback over time.
  useEffect(() => {
    if (!playing || !range) {
      return;
    }
    const start = props.filters.fromYear ?? range[0];
    const end = props.filters.toYear ?? range[1];
    const step = Math.max(1, Math.ceil((end - start) / PLAYBACK_STEPS));
    let year: number | undefined = undefined;
    const timer = setInterval(() => {
      year = year === undefined ? start : year + step;
      if (year >= end) {
        // Finished: show the whole range again.
        setPlaying(false);
        setPlayYear(undefined);
      } else {
        setPlayYear(year);
      }
    }, PLAYBACK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, range, props.filters.fromYear, props.filters.toYear]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      setPlayYear(undefined);
    } else {
      setPlaying(true);
    }
  }

  function createPopup(placeKey: string, placeEvents: PlacedEvent[]) {
    const root = document.createElement('div');
    root.className = 'map-popup';
    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = placeKey;
    root.appendChild(title);

    const byIndi = new Map<string, PlacedEvent[]>();
    placeEvents.forEach((e) =>
      byIndi.set(e.indiId, [...(byIndi.get(e.indiId) ?? []), e]),
    );
    const list = document.createElement('ul');
    byIndi.forEach((indiEvents, indiId) => {
      const item = document.createElement('li');
      const link = document.createElement('span');
      link.className = 'link-span';
      link.textContent = indiName(indiMap.get(indiId), indiId);
      link.title = intl.formatMessage({
        id: 'map.popup.link_title',
        defaultMessage: 'Click: show in chart. Shift+click: show details.',
      });
      link.addEventListener('click', (event) => {
        const info = {id: indiId, generation: 0};
        if (event.shiftKey) {
          callbacksRef.current.onDetailSelection(info);
        } else {
          callbacksRef.current.onSelection(info);
        }
      });
      item.appendChild(link);
      const details = indiEvents
        .map(
          (e) =>
            intl.formatMessage(tagMessage(e.tag)).toLowerCase() +
            (e.year !== undefined
              ? ` ${e.approximate ? '~' : ''}${e.year}`
              : ''),
        )
        .join(', ');
      item.appendChild(document.createTextNode(` – ${details}`));
      list.appendChild(item);
    });
    root.appendChild(list);
    return root;
  }

  return (
    <div className="map-view" data-testid="map-view">
      <MapFilterBar
        filters={props.filters}
        onChange={props.onFiltersChange}
        range={range}
        playing={playing}
        playYear={playYear}
        onPlayToggle={togglePlay}
      />
      <div className="map-container-wrapper">
        <div className="map-container" ref={containerRef} />
        {playYear !== undefined ? (
          <div className="map-play-year">{playYear}</div>
        ) : null}
        <div className="map-overlay-bottom">
          {summary.noPlace || summary.noCoordinates ? (
            <div className="map-summary" data-testid="map-summary">
              <FormattedMessage
                id="map.summary"
                defaultMessage="Not on the map: {noPlace} without place, {noCoordinates} without coordinates"
                values={{...summary}}
              />
            </div>
          ) : null}
          <MissingPlaces
            placeData={props.placeData}
            indiMap={indiMap}
            onSelection={props.onSelection}
            onDetailSelection={props.onDetailSelection}
          />
        </div>
      </div>
    </div>
  );
}
