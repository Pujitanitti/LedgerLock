/**
 * An inheritance edge means: childRoleId inherits all permissions granted
 * to parentRoleId. E.g. { parentRoleId: 'Admin', childRoleId: 'Owner' }
 * means Owner inherits Admin's permissions.
 */
export interface InheritanceEdge {
  parentRoleId: string;
  childRoleId: string;
}

/**
 * Determines whether adding a new (newParentId -> newChildId) inheritance
 * edge would create a cycle in the existing graph.
 *
 * A cycle is created iff `newChildId` is already a (transitive) ancestor
 * of `newParentId` in the CURRENT graph — because after adding the edge,
 * the chain would be: newChildId -> ... -> newParentId -> newChildId,
 * looping forever. This is checked by walking UP from `newParentId`
 * through existing parent links and seeing whether `newChildId` is ever
 * reached. A direct self-reference (newParentId === newChildId) is the
 * trivial 1-node case of the same check.
 *
 * Pure and DB-free by design: the (small, tenant-scoped) edge list is
 * fetched once by the caller; this function makes the actual cycle
 * determination testable without a database, and is only ever invoked at
 * write time (adding an inheritance edge is rare) — NOT on the
 * authorization hot path, which uses a recursive CTE instead (see
 * PrismaRbacRepository.getEffectivePermissionActions).
 */
export function wouldCreateCycle(
  edges: InheritanceEdge[],
  newParentId: string,
  newChildId: string,
): boolean {
  if (newParentId === newChildId) return true;

  const parentsOf = new Map<string, string[]>();
  for (const edge of edges) {
    const parents = parentsOf.get(edge.childRoleId) ?? [];
    parents.push(edge.parentRoleId);
    parentsOf.set(edge.childRoleId, parents);
  }

  const visited = new Set<string>();
  const stack = [newParentId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === newChildId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const parent of parentsOf.get(current) ?? []) {
      stack.push(parent);
    }
  }
  return false;
}

/**
 * Given the full set of inheritance edges for a tenant and a user's
 * DIRECTLY assigned role IDs, returns every role ID the user effectively
 * holds — the direct roles plus every ancestor reachable by following
 * parent links.
 *
 * This is the reference algorithm for what the production recursive CTE
 * (PrismaRbacRepository.getEffectivePermissionActions) must compute. It is
 * not itself used on the authorization hot path for large role graphs —
 * see the module doc comment above — but is exercised directly and
 * thoroughly here so the *semantics* (diamond inheritance, multiple
 * parents, multi-level chains) are proven independent of SQL.
 */
export function resolveEffectiveRoleIds(
  edges: InheritanceEdge[],
  directRoleIds: readonly string[],
): Set<string> {
  const parentsOf = new Map<string, string[]>();
  for (const edge of edges) {
    const parents = parentsOf.get(edge.childRoleId) ?? [];
    parents.push(edge.parentRoleId);
    parentsOf.set(edge.childRoleId, parents);
  }

  const effective = new Set<string>();
  const stack = [...directRoleIds];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (effective.has(current)) continue;
    effective.add(current);
    for (const parent of parentsOf.get(current) ?? []) {
      stack.push(parent);
    }
  }
  return effective;
}
