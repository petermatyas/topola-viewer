import {describe, expect, it} from '@jest/globals';
import {JsonGedcomData} from 'topola';
import {filterByGenerations} from './generation_filter';

// Four generations in a line:
// GP (grandparent) -> P (parent) -> ME (+ spouse SP, sibling SIB) -> C (child) -> GC (grandchild)
const DATA: JsonGedcomData = {
  indis: [
    {id: 'GP', fams: ['F0']},
    {id: 'P', famc: 'F0', fams: ['F1']},
    {id: 'ME', famc: 'F1', fams: ['F2']},
    {id: 'SIB', famc: 'F1'},
    {id: 'SP', fams: ['F2']},
    {id: 'C', famc: 'F2', fams: ['F3']},
    {id: 'GC', famc: 'F3'},
  ],
  fams: [
    {id: 'F0', husb: 'GP', children: ['P']},
    {id: 'F1', husb: 'P', children: ['ME', 'SIB']},
    {id: 'F2', husb: 'ME', wife: 'SP', children: ['C']},
    {id: 'F3', husb: 'C', children: ['GC']},
  ],
};

const ids = (data: JsonGedcomData) => data.indis.map((i) => i.id).sort();

describe('filterByGenerations', () => {
  it('returns the data unchanged without limits', () => {
    expect(filterByGenerations(DATA, 'ME', undefined, undefined)).toBe(DATA);
  });

  it('returns the data unchanged for an unknown start individual', () => {
    expect(filterByGenerations(DATA, 'XX', 1, 1)).toBe(DATA);
  });

  it('limits ancestors and descendants', () => {
    const result = filterByGenerations(DATA, 'ME', 1, 1);
    expect(ids(result)).toEqual(['C', 'ME', 'P', 'SIB', 'SP']);
    expect(result.fams.map((f) => f.id).sort()).toEqual(['F1', 'F2', 'F3']);
  });

  it('removes references to removed families and individuals', () => {
    const result = filterByGenerations(DATA, 'ME', 1, 1);
    const p = result.indis.find((i) => i.id === 'P');
    expect(p?.famc).toBeUndefined();
    const f3 = result.fams.find((f) => f.id === 'F3');
    expect(f3?.children).toEqual([]);
  });

  it('shows only the start generation with zero limits', () => {
    expect(ids(filterByGenerations(DATA, 'ME', 0, 0))).toEqual([
      'ME',
      'SIB',
      'SP',
    ]);
  });

  it('limits only one direction', () => {
    expect(ids(filterByGenerations(DATA, 'ME', 0, undefined))).toEqual([
      'C',
      'GC',
      'ME',
      'SIB',
      'SP',
    ]);
  });
});
