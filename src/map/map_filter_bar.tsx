import {FormattedMessage, useIntl} from 'react-intl';
import {Button, Checkbox, Dropdown, Icon, Input} from 'semantic-ui-react';
import {CATEGORY_COLORS} from './map_colors';
import {MapFilters, MovementMode, PeopleScope} from './map_filters';
import {ALL_EVENT_CATEGORIES, EventCategory} from './places';

interface Props {
  filters: MapFilters;
  onChange: (filters: MapFilters) => void;
  /** Year range of the data, used as placeholders. */
  range?: [number, number];
  playing: boolean;
  /** Year shown during playback. */
  playYear?: number;
  onPlayToggle: () => void;
}

const CATEGORY_MESSAGES = new Map<
  EventCategory,
  {id: string; defaultMessage: string}
>([
  [EventCategory.BIRTH, {id: 'map.category.birth', defaultMessage: 'Birth'}],
  [
    EventCategory.MARRIAGE,
    {id: 'map.category.marriage', defaultMessage: 'Marriage'},
  ],
  [
    EventCategory.RESIDENCE,
    {id: 'map.category.residence', defaultMessage: 'Residence'},
  ],
  [EventCategory.DEATH, {id: 'map.category.death', defaultMessage: 'Death'}],
  [EventCategory.OTHER, {id: 'map.category.other', defaultMessage: 'Other'}],
]);

function parseYearInput(value: string): number | undefined {
  return /^-?\d+$/.test(value.trim()) ? parseInt(value, 10) : undefined;
}

/** Filter controls shown above the map. */
export function MapFilterBar(props: Props) {
  const intl = useIntl();
  const {filters, onChange} = props;
  const update = (changes: Partial<MapFilters>) =>
    onChange({...filters, ...changes});

  const scopeOptions = [
    {
      value: PeopleScope.CHART,
      text: intl.formatMessage({
        id: 'map.scope.chart',
        defaultMessage: 'People in the chart',
      }),
    },
    {
      value: PeopleScope.ALL,
      text: intl.formatMessage({
        id: 'map.scope.all',
        defaultMessage: 'Whole tree',
      }),
    },
    {
      value: PeopleScope.PERSON,
      text: intl.formatMessage({
        id: 'map.scope.person',
        defaultMessage: 'Selected person',
      }),
    },
    {
      value: PeopleScope.FAMILY,
      text: intl.formatMessage({
        id: 'map.scope.family',
        defaultMessage: 'Immediate family',
      }),
    },
    {
      value: PeopleScope.ANCESTORS,
      text: intl.formatMessage({
        id: 'map.scope.ancestors',
        defaultMessage: 'Ancestors',
      }),
    },
    {
      value: PeopleScope.DESCENDANTS,
      text: intl.formatMessage({
        id: 'map.scope.descendants',
        defaultMessage: 'Descendants',
      }),
    },
  ];

  const movementOptions = [
    {
      value: MovementMode.ANCESTORS,
      text: intl.formatMessage({
        id: 'map.movements.ancestors',
        defaultMessage: 'Lines: ancestors',
      }),
    },
    {
      value: MovementMode.FAMILY,
      text: intl.formatMessage({
        id: 'map.movements.family',
        defaultMessage: 'Lines: family',
      }),
    },
    {
      value: MovementMode.PERSON,
      text: intl.formatMessage({
        id: 'map.movements.person',
        defaultMessage: 'Lines: selected person',
      }),
    },
    {
      value: MovementMode.OFF,
      text: intl.formatMessage({
        id: 'map.movements.off',
        defaultMessage: 'No lines',
      }),
    },
  ];

  function toggleCategory(category: EventCategory, checked: boolean) {
    const categories = ALL_EVENT_CATEGORIES.filter((c) =>
      c === category ? checked : filters.categories.includes(c),
    );
    update({categories});
  }

  return (
    <div className="map-filter-bar" data-testid="map-filter-bar">
      <div className="map-filter-row">
        <Dropdown
          selection
          compact
          className="map-scope"
          options={scopeOptions}
          value={filters.scope}
          onChange={(_, {value}) => update({scope: value as PeopleScope})}
        />
        <Input
          size="small"
          icon="search"
          className="map-surname"
          placeholder={intl.formatMessage({
            id: 'map.surname',
            defaultMessage: 'Surname',
          })}
          value={filters.surname}
          onChange={(_, {value}) => update({surname: value})}
        />
        <Dropdown
          selection
          compact
          className="map-movements"
          options={movementOptions}
          value={filters.movements}
          onChange={(_, {value}) => update({movements: value as MovementMode})}
        />
      </div>
      <div className="map-filter-row">
        {ALL_EVENT_CATEGORIES.map((category) => (
          <Checkbox
            key={category}
            className="map-category"
            checked={filters.categories.includes(category)}
            onChange={(_, {checked}) => toggleCategory(category, !!checked)}
            label={
              <label>
                <span
                  className="map-legend-dot"
                  style={{background: CATEGORY_COLORS.get(category)}}
                />
                {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
                <FormattedMessage {...CATEGORY_MESSAGES.get(category)!} />
              </label>
            }
          />
        ))}
      </div>
      <div className="map-filter-row">
        <Input
          size="small"
          type="number"
          className="map-year"
          placeholder={props.range ? String(props.range[0]) : ''}
          value={filters.fromYear ?? ''}
          aria-label={intl.formatMessage({
            id: 'map.from_year',
            defaultMessage: 'From year',
          })}
          onChange={(_, {value}) => update({fromYear: parseYearInput(value)})}
        />
        –
        <Input
          size="small"
          type="number"
          className="map-year"
          placeholder={props.range ? String(props.range[1]) : ''}
          value={props.playYear ?? filters.toYear ?? ''}
          disabled={props.playing}
          aria-label={intl.formatMessage({
            id: 'map.to_year',
            defaultMessage: 'To year',
          })}
          onChange={(_, {value}) => update({toYear: parseYearInput(value)})}
        />
        <Button
          size="small"
          icon
          className="map-play"
          disabled={!props.range}
          onClick={props.onPlayToggle}
          title={intl.formatMessage(
            props.playing
              ? {id: 'map.stop', defaultMessage: 'Stop'}
              : {id: 'map.play', defaultMessage: 'Play over time'},
          )}
        >
          <Icon name={props.playing ? 'stop' : 'play'} />
        </Button>
        <Checkbox
          className="map-undated"
          checked={filters.showUndated}
          onChange={(_, {checked}) => update({showUndated: !!checked})}
          label={intl.formatMessage({
            id: 'map.undated',
            defaultMessage: 'Undated events',
          })}
        />
      </div>
    </div>
  );
}
