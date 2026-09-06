import { resolveEffectiveRoleIds, wouldCreateCycle, type InheritanceEdge } from './role-hierarchy-graph';

describe('wouldCreateCycle', () => {
  it('rejects a role inheriting from itself', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true);
  });

  it('allows the first-ever edge in an empty graph', () => {
    expect(wouldCreateCycle([], 'Admin', 'Owner')).toBe(false);
  });

  it('rejects a direct two-node cycle (A -> B, then B -> A)', () => {
    const edges: InheritanceEdge[] = [{ parentRoleId: 'A', childRoleId: 'B' }];
    // B already inherits A. Adding "A inherits B" would create A -> B -> A.
    expect(wouldCreateCycle(edges, 'B', 'A')).toBe(true);
  });

  it('rejects a transitive three-node cycle (A->B->C, then C->A)', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'B', childRoleId: 'C' },
    ];
    // C already (transitively) inherits A. Adding "A inherits C" closes the loop.
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true);
  });

  it('allows a valid new edge that does not touch the existing chain', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'B', childRoleId: 'C' },
    ];
    expect(wouldCreateCycle(edges, 'X', 'Y')).toBe(false);
  });

  it('allows extending an existing chain further (D inherits C)', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'B', childRoleId: 'C' },
    ];
    expect(wouldCreateCycle(edges, 'C', 'D')).toBe(false);
  });

  it('allows diamond inheritance (D inherits both B and C, which both inherit A)', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'A', childRoleId: 'C' },
      { parentRoleId: 'B', childRoleId: 'D' },
    ];
    expect(wouldCreateCycle(edges, 'C', 'D')).toBe(false);
  });

  it('rejects a cycle introduced through a second parent (multiple-parent case)', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'X', childRoleId: 'A' },
    ];
    // A already inherits X (transitively via direct edge). B inherits A.
    // Adding "B inherits X" is fine (no cycle) ...
    expect(wouldCreateCycle(edges, 'X', 'B')).toBe(false);
    // ... but adding "X inherits B" would create B -> A -> X -> B.
    expect(wouldCreateCycle(edges, 'B', 'X')).toBe(true);
  });

  it('does not false-positive on a disjoint, unrelated subgraph', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'P', childRoleId: 'Q' },
    ];
    expect(wouldCreateCycle(edges, 'Q', 'A')).toBe(false);
  });
});

describe('resolveEffectiveRoleIds', () => {
  it('returns just the direct role when there is no inheritance', () => {
    expect(resolveEffectiveRoleIds([], ['Member'])).toEqual(new Set(['Member']));
  });

  it('resolves a single level of inheritance', () => {
    const edges: InheritanceEdge[] = [{ parentRoleId: 'Admin', childRoleId: 'Owner' }];
    expect(resolveEffectiveRoleIds(edges, ['Owner'])).toEqual(new Set(['Owner', 'Admin']));
  });

  it('resolves a multi-level chain (Owner -> Admin -> Member)', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'Admin', childRoleId: 'Owner' },
      { parentRoleId: 'Member', childRoleId: 'Admin' },
    ];
    expect(resolveEffectiveRoleIds(edges, ['Owner'])).toEqual(new Set(['Owner', 'Admin', 'Member']));
  });

  it('dedupes diamond inheritance (D inherits B and C, both inherit A)', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'A', childRoleId: 'C' },
      { parentRoleId: 'B', childRoleId: 'D' },
      { parentRoleId: 'C', childRoleId: 'D' },
    ];
    expect(resolveEffectiveRoleIds(edges, ['D'])).toEqual(new Set(['D', 'B', 'C', 'A']));
  });

  it('combines effective roles across multiple directly assigned roles', () => {
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'Admin', childRoleId: 'Owner' },
      { parentRoleId: 'X', childRoleId: 'Y' },
    ];
    expect(resolveEffectiveRoleIds(edges, ['Owner', 'Y'])).toEqual(new Set(['Owner', 'Admin', 'Y', 'X']));
  });

  it('handles a leaf role with no inheritance edges at all', () => {
    const edges: InheritanceEdge[] = [{ parentRoleId: 'Admin', childRoleId: 'Owner' }];
    expect(resolveEffectiveRoleIds(edges, ['UnrelatedRole'])).toEqual(new Set(['UnrelatedRole']));
  });

  it('returns an empty set for an empty direct-role list', () => {
    expect(resolveEffectiveRoleIds([{ parentRoleId: 'A', childRoleId: 'B' }], [])).toEqual(new Set());
  });

  it('does not infinite-loop even if given a malformed cyclic edge list (defensive)', () => {
    // Cycles should never reach this function in practice (rejected at
    // write time by wouldCreateCycle), but the traversal itself must not
    // hang if one somehow did — the `visited` set guarantees termination.
    const edges: InheritanceEdge[] = [
      { parentRoleId: 'A', childRoleId: 'B' },
      { parentRoleId: 'B', childRoleId: 'A' },
    ];
    const result = resolveEffectiveRoleIds(edges, ['A']);
    expect(result).toEqual(new Set(['A', 'B']));
  });
});
