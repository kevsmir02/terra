export type PaneId = number;

export type SplitDir = "row" | "col";
export type PaneDirection = "left" | "right" | "up" | "down";
export type PaneBounds = {
  id: PaneId;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type PaneNode =
  | { kind: "leaf"; id: PaneId; slotId?: PaneId; cwd?: string }
  | {
      kind: "split";
      id: PaneId;
      dir: SplitDir;
      children: PaneNode[];
      /** Percent share per child, summing to 100. Absent means equal. */
      sizes?: number[];
    };

type SplitNode = Extract<PaneNode, { kind: "split" }>;

const SIZE_SUM_TOLERANCE = 1;
const SIZE_CHANGE_EPSILON = 0.1;

export function equalSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

/**
 * `sizes` rescaled to sum to exactly 100, or null when it cannot describe
 * `count` children: wrong length, a non-finite or non-positive share, or a
 * total that is not already 100 (a hand-edited or corrupted store).
 */
export function validSizes(sizes: unknown, count: number): number[] | null {
  if (!Array.isArray(sizes) || count < 2 || sizes.length !== count) return null;
  let sum = 0;
  for (const v of sizes) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    sum += v;
  }
  if (Math.abs(sum - 100) > SIZE_SUM_TOLERANCE) return null;
  return sizes.map((v: number) => (v * 100) / sum);
}

export function splitSizes(node: SplitNode): number[] {
  return (
    validSizes(node.sizes, node.children.length) ??
    equalSizes(node.children.length)
  );
}

function rescale(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((v) => (v * 100) / sum);
}

function sameSizes(a: number[], b: number[]): boolean {
  return (
    a.length === b.length &&
    a.every((v, i) => Math.abs(v - b[i]) < SIZE_CHANGE_EPSILON)
  );
}

/**
 * Record the shares the user dragged a split to. Returns the same tree when
 * nothing moved or the sizes are unusable, so a no-op never re-renders.
 */
export function setSplitSizes(
  tree: PaneNode,
  splitId: PaneId,
  sizes: number[],
): PaneNode {
  if (isLeaf(tree)) return tree;
  if (tree.id === splitId) {
    const next = validSizes(sizes, tree.children.length);
    if (!next || sameSizes(next, splitSizes(tree))) return tree;
    return { ...tree, sizes: next };
  }
  let changed = false;
  const children = tree.children.map((c) => {
    const u = setSplitSizes(c, splitId, sizes);
    if (u !== c) changed = true;
    return u;
  });
  return changed ? { ...tree, children } : tree;
}

export function isLeaf(n: PaneNode): n is Extract<PaneNode, { kind: "leaf" }> {
  return n.kind === "leaf";
}

export function leafIds(n: PaneNode): PaneId[] {
  if (isLeaf(n)) return [n.id];
  return n.children.flatMap(leafIds);
}

export function firstLeafSlotId(n: PaneNode): PaneId {
  if (isLeaf(n)) return n.slotId ?? n.id;
  return firstLeafSlotId(n.children[0]);
}

export function findLeafCwd(n: PaneNode, id: PaneId): string | undefined {
  if (isLeaf(n)) return n.id === id ? n.cwd : undefined;
  for (const c of n.children) {
    const found = findLeafCwd(c, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function setLeafCwd(n: PaneNode, id: PaneId, cwd: string): PaneNode {
  if (isLeaf(n)) {
    if (n.id !== id || n.cwd === cwd) return n;
    return { ...n, cwd };
  }
  let changed = false;
  const next = n.children.map((c) => {
    const u = setLeafCwd(c, id, cwd);
    if (u !== c) changed = true;
    return u;
  });
  return changed ? { ...n, children: next } : n;
}

/**
 * Insert a new leaf next to `targetId` in direction `dir`.
 *
 * If the target's enclosing split already runs in `dir`, the new leaf is
 * appended as a sibling there (avoids nested same-direction splits, keeps
 * the tree shallow and the resize handles aligned).
 */
export function splitLeaf(
  tree: PaneNode,
  targetId: PaneId,
  newSplitId: PaneId,
  newLeafId: PaneId,
  dir: SplitDir,
  newCwd?: string,
): PaneNode {
  if (tree.kind === "split" && tree.dir === dir) {
    const idx = tree.children.findIndex(
      (c) => c.kind === "leaf" && c.id === targetId,
    );
    if (idx >= 0) {
      const newLeaf: PaneNode = { kind: "leaf", id: newLeafId, cwd: newCwd };
      // The new pane takes half of the one it split, leaving the rest as sized.
      const shares = splitSizes(tree);
      const half = shares[idx] / 2;
      return {
        ...tree,
        ...(tree.sizes !== undefined && {
          sizes: [
            ...shares.slice(0, idx),
            half,
            half,
            ...shares.slice(idx + 1),
          ],
        }),
        children: [
          ...tree.children.slice(0, idx + 1),
          newLeaf,
          ...tree.children.slice(idx + 1),
        ],
      };
    }
  }
  if (isLeaf(tree)) {
    if (tree.id !== targetId) return tree;
    const newLeaf: PaneNode = { kind: "leaf", id: newLeafId, cwd: newCwd };
    return {
      kind: "split",
      id: newSplitId,
      dir,
      children: [tree, newLeaf],
    };
  }
  return {
    ...tree,
    children: tree.children.map((c) =>
      splitLeaf(c, targetId, newSplitId, newLeafId, dir, newCwd),
    ),
  };
}

/**
 * Remove a leaf and collapse single-child splits left in its wake. Returns
 * `null` when the entire subtree is gone.
 */
export function removeLeaf(tree: PaneNode, targetId: PaneId): PaneNode | null {
  if (isLeaf(tree)) return tree.id === targetId ? null : tree;
  const shares = splitSizes(tree);
  const newChildren: PaneNode[] = [];
  const newShares: number[] = [];
  tree.children.forEach((c, i) => {
    const r = removeLeaf(c, targetId);
    if (r === null) return;
    newChildren.push(r);
    newShares.push(shares[i]);
  });
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  if (tree.sizes === undefined || newChildren.length === tree.children.length)
    return { ...tree, children: newChildren };
  // Survivors keep their proportions to one another.
  return { ...tree, children: newChildren, sizes: rescale(newShares) };
}

export function nextLeafId(
  tree: PaneNode,
  currentId: PaneId,
  delta: 1 | -1,
): PaneId {
  const ids = leafIds(tree);
  if (ids.length === 0) return currentId;
  const idx = ids.indexOf(currentId);
  if (idx < 0) return ids[0];
  return ids[(idx + delta + ids.length) % ids.length];
}

// Closest neighbor of `leafId` within its enclosing split, prefer the
// next sibling, fall back to the previous. Used to pick the new focus
// when a pane closes (so focus stays in the same neighborhood instead of
// snapping to the first pane in the tree).
export function siblingLeafOf(tree: PaneNode, leafId: PaneId): PaneId | null {
  if (isLeaf(tree)) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const c = tree.children[i];
    if (isLeaf(c) && c.id === leafId) {
      const sibling = tree.children[i + 1] ?? tree.children[i - 1];
      if (!sibling) return null;
      return leafIds(sibling)[0] ?? null;
    }
  }
  for (const c of tree.children) {
    if (!isLeaf(c)) {
      const r = siblingLeafOf(c, leafId);
      if (r !== null) return r;
    }
  }
  return null;
}

export function hasLeaf(tree: PaneNode, id: PaneId): boolean {
  return leafIds(tree).includes(id);
}

type PaneRect = {
  id: PaneId;
  x: number;
  y: number;
  width: number;
  height: number;
};

function paneRects(
  node: PaneNode,
  x = 0,
  y = 0,
  width = 1,
  height = 1,
): PaneRect[] {
  if (isLeaf(node)) return [{ id: node.id, x, y, width, height }];
  const shares = splitSizes(node);
  let offset = 0;
  return node.children.flatMap((child, index) => {
    const start = offset / 100;
    const share = shares[index] / 100;
    offset += shares[index];
    return node.dir === "row"
      ? paneRects(child, x + width * start, y, width * share, height)
      : paneRects(child, x, y + height * start, width, height * share);
  });
}

function directionalTarget(
  rects: PaneRect[],
  active: PaneRect,
  direction: PaneDirection,
): PaneId | null {
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "down";
  const center = (r: PaneRect) =>
    horizontal ? r.x + r.width / 2 : r.y + r.height / 2;
  const crossCenter = (r: PaneRect) =>
    horizontal ? r.y + r.height / 2 : r.x + r.width / 2;
  const crossStart = (r: PaneRect) => (horizontal ? r.y : r.x);
  const crossEnd = (r: PaneRect) =>
    horizontal ? r.y + r.height : r.x + r.width;
  const overlaps = (r: PaneRect) =>
    crossStart(r) < crossEnd(active) && crossEnd(r) > crossStart(active);
  const others = rects.filter((r) => r.id !== active.id && overlaps(r));
  if (others.length === 0) return null;

  const ahead = others.filter((r) =>
    forward ? center(r) > center(active) : center(r) < center(active),
  );
  const candidates = ahead.length > 0 ? ahead : others;
  candidates.sort((a, b) => {
    const axisA =
      ahead.length > 0
        ? Math.abs(center(a) - center(active))
        : forward
          ? center(a)
          : -center(a);
    const axisB =
      ahead.length > 0
        ? Math.abs(center(b) - center(active))
        : forward
          ? center(b)
          : -center(b);
    return (
      axisA - axisB ||
      Math.abs(crossCenter(a) - crossCenter(active)) -
        Math.abs(crossCenter(b) - crossCenter(active))
    );
  });
  return candidates[0]?.id ?? null;
}

function findLeaf(
  node: PaneNode,
  id: PaneId,
): Extract<PaneNode, { kind: "leaf" }> | null {
  if (isLeaf(node)) return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

function swapLeaves(
  node: PaneNode,
  first: Extract<PaneNode, { kind: "leaf" }>,
  second: Extract<PaneNode, { kind: "leaf" }>,
): PaneNode {
  if (isLeaf(node)) {
    const slotId = node.slotId ?? node.id;
    if (node.id === first.id) return { ...second, slotId };
    if (node.id === second.id) return { ...first, slotId };
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => swapLeaves(child, first, second)),
  };
}

function rectsFromBounds(bounds: PaneBounds[]): PaneRect[] {
  return bounds
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top)
    .map((rect) => ({
      id: rect.id,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    }));
}

export function swapLeafInDirection(
  tree: PaneNode,
  activeId: PaneId,
  direction: PaneDirection,
  liveBounds?: PaneBounds[],
): PaneNode {
  const liveRects = liveBounds ? rectsFromBounds(liveBounds) : [];
  const liveIds = new Set(liveRects.map((rect) => rect.id));
  const hasCompleteLiveLayout = leafIds(tree).every((id) => liveIds.has(id));
  const rects = hasCompleteLiveLayout ? liveRects : paneRects(tree);
  const active = rects.find((rect) => rect.id === activeId);
  if (!active || rects.length < 2) return tree;
  const targetId = directionalTarget(rects, active, direction);
  if (targetId === null) return tree;
  const first = findLeaf(tree, activeId);
  const second = findLeaf(tree, targetId);
  return first && second ? swapLeaves(tree, first, second) : tree;
}
