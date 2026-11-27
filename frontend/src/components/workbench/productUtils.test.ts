import { describe, expect, it } from 'bun:test';
import { Tag, TagImplication } from '../../types';
import {
  getEffectiveTagsForIds,
  getImpliedParentSources,
  pruneRedundantAncestorTagIds,
} from './productUtils';

const tags: Tag[] = [
  { id: 1, name: 'Mele', group: 'Food', color: '#000000' },
  { id: 2, name: 'Frutta', group: 'Food', color: '#000000' },
  { id: 3, name: 'Alimentari', group: 'Food', color: '#000000' },
  { id: 4, name: 'Bio', group: 'Attribute', color: '#000000' },
  { id: 5, name: 'Pere', group: 'Food', color: '#000000' },
];

const implications: TagImplication[] = [
  { child_tag_id: 1, parent_tag_id: 2 }, // Mele -> Frutta
  { child_tag_id: 5, parent_tag_id: 2 }, // Pere -> Frutta
  { child_tag_id: 2, parent_tag_id: 3 }, // Frutta -> Alimentari
];

describe('productUtils tag enforcement helpers', () => {
  it('prunes redundant direct ancestors while preserving order and orthogonal tags', () => {
    expect(pruneRedundantAncestorTagIds([2, 1, 3, 4, 1], implications)).toEqual([1, 4]);
    expect(pruneRedundantAncestorTagIds([2, 4, 3], implications)).toEqual([2, 4]);
    expect(pruneRedundantAncestorTagIds([3, 4], implications)).toEqual([3, 4]);
  });

  it('tracks which direct child tags require each implied ancestor', () => {
    const sources = getImpliedParentSources([1, 5, 4], tags, implications);
    expect(sources.get(2)?.map(t => t.name)).toEqual(['Mele', 'Pere']);
    expect(sources.get(3)?.map(t => t.name)).toEqual(['Mele', 'Pere']);
    expect(sources.has(1)).toBe(false);
    expect(sources.has(4)).toBe(false);
  });

  it('computes effective direct and implied tags cleanly after pruning', () => {
    const pruned = pruneRedundantAncestorTagIds([2, 1, 4], implications);
    const eff = getEffectiveTagsForIds(pruned, tags, implications);
    expect(eff.direct.map(t => t.name)).toEqual(['Mele', 'Bio']);
    expect(eff.implied.map(t => t.name)).toEqual(['Alimentari', 'Frutta']);
  });
});
