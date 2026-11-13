import queryString from 'query-string';
import {ReactNode, useCallback, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router';
import {IndiInfo} from 'topola';
import {Config} from '../sidepanel/config/config';
import {TopolaData} from '../util/gedcom_util';
import {getUrlForArgs} from '../util/url_args';
import {MapFilters, mapFiltersToArgs, parseMapFilters} from './map_filters';
import {MapView} from './map_view';
import {extractPlaces} from './places';

const SPLIT_STORAGE_KEY = 'topola-map-split';
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;

function loadSplit(): number {
  try {
    const value = parseFloat(localStorage.getItem(SPLIT_STORAGE_KEY) ?? '');
    if (value >= MIN_SPLIT && value <= MAX_SPLIT) {
      return value;
    }
  } catch (e) {
    // Storage is not available, use the default.
  }
  return 0.5;
}

function saveSplit(value: number) {
  try {
    localStorage.setItem(SPLIT_STORAGE_KEY, String(value));
  } catch (e) {
    // Storage is not available, the split is not remembered.
  }
}

interface Props {
  /** The chart shown on the left side. */
  chart: ReactNode;
  data: TopolaData;
  selection: IndiInfo;
  config: Config;
  onSelection: (indiInfo: IndiInfo) => void;
  onDetailSelection: (indiInfo: IndiInfo) => void;
}

/**
 * Chart on the left, map on the right, with a draggable divider. The map
 * filters are stored in the URL.
 */
export default function MapPage(props: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [split, setSplit] = useState(loadSplit);
  const splitRef = useRef<HTMLDivElement>(null);

  const placeData = useMemo(
    () => extractPlaces(props.data.gedcom),
    [props.data],
  );

  const filters = useMemo(
    () => parseMapFilters(queryString.parse(location.search)),
    [location.search],
  );

  const onFiltersChange = useCallback(
    (newFilters: MapFilters) => {
      navigate(getUrlForArgs(location, mapFiltersToArgs(newFilters)), {
        replace: true,
      });
    },
    [location, navigate],
  );

  function startDrag(event: React.PointerEvent) {
    const container = splitRef.current;
    if (!container) {
      return;
    }
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    let value = split;
    const move = (e: PointerEvent) => {
      value = Math.min(
        MAX_SPLIT,
        Math.max(MIN_SPLIT, (e.clientX - rect.left) / rect.width),
      );
      setSplit(value);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('map-dragging');
      saveSplit(value);
    };
    document.body.classList.add('map-dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="map-split" ref={splitRef} data-testid="map-split">
      <div className="map-split-chart" style={{flexBasis: `${split * 100}%`}}>
        {props.chart}
      </div>
      <div
        className="map-split-divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startDrag}
      />
      <div className="map-split-map">
        <MapView
          data={props.data}
          placeData={placeData}
          selection={props.selection}
          config={props.config}
          filters={filters}
          onFiltersChange={onFiltersChange}
          onSelection={props.onSelection}
          onDetailSelection={props.onDetailSelection}
        />
      </div>
    </div>
  );
}
