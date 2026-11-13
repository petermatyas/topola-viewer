import {useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {Button, Icon} from 'semantic-ui-react';
import {IndiInfo, JsonIndi} from 'topola';
import {hasCoordinates, PlaceData} from './places';

interface Props {
  placeData: PlaceData;
  indiMap: Map<string, JsonIndi>;
  onSelection: (indiInfo: IndiInfo) => void;
  onDetailSelection: (indiInfo: IndiInfo) => void;
}

export function indiName(indi: JsonIndi | undefined, fallback: string) {
  const name = [indi?.firstName, indi?.lastName].filter(Boolean).join(' ');
  return name || fallback;
}

/**
 * Lists the places that have no coordinates (or conflicting ones) in the
 * GEDCOM file, most frequent first, so that they can be fixed in the
 * genealogy program.
 */
export function MissingPlaces(props: Props) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [copied, setCopied] = useState(false);

  const items = useMemo(
    () =>
      [...props.placeData.places.values()]
        .filter((place) => !hasCoordinates(place) || place.conflict)
        .sort((a, b) => b.refCount - a.refCount || a.key.localeCompare(b.key)),
    [props.placeData],
  );

  const peopleByPlace = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const event of props.placeData.events) {
      const set = result.get(event.placeKey) ?? new Set();
      set.add(event.indiId);
      result.set(event.placeKey, set);
    }
    return result;
  }, [props.placeData]);

  if (!items.length) {
    return null;
  }

  const missingCount = items.filter((place) => !hasCoordinates(place)).length;

  async function copy() {
    const text = items
      .map((place) => `${place.key}\t${place.refCount}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Failed to copy the place list', e);
    }
  }

  return (
    <div className="map-missing" data-testid="map-missing">
      <Button size="mini" onClick={() => setOpen(!open)}>
        <Icon name="map marker alternate" />
        <FormattedMessage
          id="map.missing.button"
          defaultMessage="{count, plural, one {# place} other {# places}} without coordinates"
          values={{count: missingCount}}
        />
      </Button>
      {open ? (
        <div className="map-missing-panel">
          <div className="map-missing-header">
            <FormattedMessage
              id="map.missing.help"
              defaultMessage="Add coordinates to these places in your genealogy program and export the GEDCOM file again. Most frequent first."
            />
            <Button size="mini" icon onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} />{' '}
              {copied ? (
                <FormattedMessage
                  id="map.missing.copied"
                  defaultMessage="Copied"
                />
              ) : (
                <FormattedMessage
                  id="map.missing.copy"
                  defaultMessage="Copy list"
                />
              )}
            </Button>
          </div>
          <ul>
            {items.map((place) => (
              <li key={place.key}>
                <span
                  className="link-span"
                  onClick={() =>
                    setExpanded(expanded === place.key ? undefined : place.key)
                  }
                >
                  {place.key}
                </span>{' '}
                <span className="map-missing-count">({place.refCount})</span>
                {place.conflict ? (
                  <Icon
                    name="warning sign"
                    color="orange"
                    title={intl.formatMessage({
                      id: 'map.missing.conflict',
                      defaultMessage:
                        'Different coordinates are given for this place',
                    })}
                  />
                ) : null}
                {expanded === place.key ? (
                  <ul>
                    {[...(peopleByPlace.get(place.key) ?? [])].map((id) => (
                      <li key={id}>
                        <span
                          className="link-span"
                          onClick={(e) =>
                            e.shiftKey
                              ? props.onDetailSelection({id, generation: 0})
                              : props.onSelection({id, generation: 0})
                          }
                        >
                          {indiName(props.indiMap.get(id), id)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
