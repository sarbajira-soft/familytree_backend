import { FamilyTree } from './model/family-tree.model';

type Tx = any;

type RepairResult = {
  familyCode: string;
  totalNodes: number;
  updatedNodes: number;
  removedParentEdges: number;
  removedSpouseEdges: number;
  removedSiblingEdges: number;
};

const toNum = (v: any): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
};

const normalizeIdList = (list: any): number[] => {
  const arr = Array.isArray(list) ? list : [];
  const out: number[] = [];
  for (const x of arr) {
    const n = toNum(x);
    if (n === null) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

const arraysEqual = (a: number[], b: number[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export async function repairFamilyTreeIntegrity(params: {
  familyCode: string;
  transaction?: Tx;
  lock?: boolean;
  fixExternalGenerations?: boolean;
}): Promise<RepairResult> {
  const familyCode = String(params.familyCode || '').trim().toUpperCase();
  const transaction = params.transaction;
  const lock = Boolean(params.lock);
  const fixExternalGenerations = params.fixExternalGenerations !== false;

  if (!familyCode) {
    throw new Error('familyCode is required');
  }

  const rows = await FamilyTree.findAll({
    where: { familyCode } as any,
    transaction,
    ...(transaction && lock ? { lock: (transaction as any).LOCK.UPDATE } : {}),
  } as any);

  const byPersonId = new Map<number, any>();
  for (const r of rows as any[]) {
    const pid = toNum((r as any).personId);
    if (pid === null) continue;
    byPersonId.set(pid, r);
  }

  const parentEdges = new Set<string>();
  const spouseEdges = new Set<string>();
  const siblingEdges = new Set<string>();

  const addPair = (set: Set<string>, a: number, b: number) => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    if (a === b) return;
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    set.add(`${low}:${high}`);
  };

  for (const r of rows as any[]) {
    const pid = toNum((r as any).personId);
    if (pid === null) continue;

    const parents = normalizeIdList((r as any).parents);
    const children = normalizeIdList((r as any).children);
    const spouses = normalizeIdList((r as any).spouses);
    const siblings = normalizeIdList((r as any).siblings);

    for (const p of parents) {
      if (byPersonId.has(p) && p !== pid) {
        parentEdges.add(`${p}:${pid}`);
      }
    }
    for (const c of children) {
      if (byPersonId.has(c) && c !== pid) {
        parentEdges.add(`${pid}:${c}`);
      }
    }
    for (const s of spouses) {
      if (byPersonId.has(s) && s !== pid) {
        addPair(spouseEdges, pid, s);
      }
    }
    for (const s of siblings) {
      if (byPersonId.has(s) && s !== pid) {
        addPair(siblingEdges, pid, s);
      }
    }
  }

  let removedParentEdges = 0;

  const parentsByChild = new Map<number, number[]>();
  for (const e of parentEdges) {
    const [pStr, cStr] = e.split(':');
    const p = Number(pStr);
    const c = Number(cStr);
    if (!byPersonId.has(p) || !byPersonId.has(c)) continue;
    const arr = parentsByChild.get(c) || [];
    if (!arr.includes(p)) arr.push(p);
    parentsByChild.set(c, arr);
  }

  for (const [childId, parentIds] of parentsByChild.entries()) {
    if (parentIds.length <= 2) continue;

    const child = byPersonId.get(childId);
    const childGen = toNum((child as any)?.generation) ?? 0;

    const decorated = parentIds
      .map((p) => {
        const pr = byPersonId.get(p);
        const pGen = toNum((pr as any)?.generation) ?? 0;
        const isExternal = Boolean((pr as any)?.isExternalLinked);
        const genMatch = pGen === childGen - 1;
        return { p, isExternal, genMatch };
      })
      .sort((a, b) => {
        if (a.genMatch !== b.genMatch) return a.genMatch ? -1 : 1;
        if (a.isExternal !== b.isExternal) return a.isExternal ? 1 : -1;
        return a.p - b.p;
      });

    const keep = new Set<number>(decorated.slice(0, 2).map((x) => x.p));

    for (const p of parentIds) {
      if (keep.has(p)) continue;
      parentEdges.delete(`${p}:${childId}`);
      removedParentEdges++;
    }
  }

  let removedSpouseEdges = 0;
  let removedSiblingEdges = 0;

  const shouldDropSiblingEdge = (a: any, b: any) => {
    const ga = toNum((a as any)?.generation) ?? 0;
    const gb = toNum((b as any)?.generation) ?? 0;
    if (ga === gb) return false;

    const aExt = Boolean((a as any)?.isExternalLinked);
    const bExt = Boolean((b as any)?.isExternalLinked);
    if (fixExternalGenerations && (aExt || bExt)) return false;
    return true;
  };

  const shouldDropSpouseEdge = (a: any, b: any) => {
    const ga = toNum((a as any)?.generation) ?? 0;
    const gb = toNum((b as any)?.generation) ?? 0;
    if (ga === gb) return false;

    const aExt = Boolean((a as any)?.isExternalLinked);
    const bExt = Boolean((b as any)?.isExternalLinked);
    if (fixExternalGenerations && (aExt || bExt)) return false;
    return true;
  };

  for (const edge of Array.from(spouseEdges)) {
    const [aStr, bStr] = edge.split(':');
    const aId = Number(aStr);
    const bId = Number(bStr);
    const a = byPersonId.get(aId);
    const b = byPersonId.get(bId);
    if (!a || !b) {
      spouseEdges.delete(edge);
      removedSpouseEdges++;
      continue;
    }
    if (shouldDropSpouseEdge(a, b)) {
      spouseEdges.delete(edge);
      removedSpouseEdges++;
    }
  }

  for (const edge of Array.from(siblingEdges)) {
    const [aStr, bStr] = edge.split(':');
    const aId = Number(aStr);
    const bId = Number(bStr);
    const a = byPersonId.get(aId);
    const b = byPersonId.get(bId);
    if (!a || !b) {
      siblingEdges.delete(edge);
      removedSiblingEdges++;
      continue;
    }
    if (shouldDropSiblingEdge(a, b)) {
      siblingEdges.delete(edge);
      removedSiblingEdges++;
    }
  }

  if (fixExternalGenerations) {
    for (const e of parentEdges) {
      const [pStr, cStr] = e.split(':');
      const pId = Number(pStr);
      const cId = Number(cStr);
      const parent = byPersonId.get(pId);
      const child = byPersonId.get(cId);
      if (!parent || !child) continue;

      const childGen = toNum((child as any)?.generation) ?? 0;
      const desiredParentGen = childGen - 1;
      if (Boolean((parent as any)?.isExternalLinked)) {
        const current = toNum((parent as any)?.generation) ?? 0;
        if (current !== desiredParentGen) {
          await (parent as any).update({ generation: desiredParentGen } as any, { transaction });
        }
      }
    }

    for (const edge of spouseEdges) {
      const [aStr, bStr] = edge.split(':');
      const aId = Number(aStr);
      const bId = Number(bStr);
      const a = byPersonId.get(aId);
      const b = byPersonId.get(bId);
      if (!a || !b) continue;

      const ga = toNum((a as any)?.generation) ?? 0;
      const gb = toNum((b as any)?.generation) ?? 0;
      if (ga === gb) continue;

      if (Boolean((a as any)?.isExternalLinked)) {
        await (a as any).update({ generation: gb } as any, { transaction });
      } else if (Boolean((b as any)?.isExternalLinked)) {
        await (b as any).update({ generation: ga } as any, { transaction });
      }
    }

    for (const edge of siblingEdges) {
      const [aStr, bStr] = edge.split(':');
      const aId = Number(aStr);
      const bId = Number(bStr);
      const a = byPersonId.get(aId);
      const b = byPersonId.get(bId);
      if (!a || !b) continue;

      const ga = toNum((a as any)?.generation) ?? 0;
      const gb = toNum((b as any)?.generation) ?? 0;
      if (ga === gb) continue;

      if (Boolean((a as any)?.isExternalLinked)) {
        await (a as any).update({ generation: gb } as any, { transaction });
      } else if (Boolean((b as any)?.isExternalLinked)) {
        await (b as any).update({ generation: ga } as any, { transaction });
      }
    }
  }

  const nextParents = new Map<number, number[]>();
  const nextChildren = new Map<number, number[]>();

  for (const e of parentEdges) {
    const [pStr, cStr] = e.split(':');
    const p = Number(pStr);
    const c = Number(cStr);
    if (!byPersonId.has(p) || !byPersonId.has(c)) continue;

    const plist = nextChildren.get(p) || [];
    if (!plist.includes(c)) plist.push(c);
    nextChildren.set(p, plist);

    const clist = nextParents.get(c) || [];
    if (!clist.includes(p)) clist.push(p);
    nextParents.set(c, clist);
  }

  const nextSpouses = new Map<number, number[]>();
  for (const edge of spouseEdges) {
    const [aStr, bStr] = edge.split(':');
    const a = Number(aStr);
    const b = Number(bStr);
    if (!byPersonId.has(a) || !byPersonId.has(b)) continue;
    const aList = nextSpouses.get(a) || [];
    const bList = nextSpouses.get(b) || [];
    if (!aList.includes(b)) aList.push(b);
    if (!bList.includes(a)) bList.push(a);
    nextSpouses.set(a, aList);
    nextSpouses.set(b, bList);
  }

  const nextSiblings = new Map<number, number[]>();
  for (const edge of siblingEdges) {
    const [aStr, bStr] = edge.split(':');
    const a = Number(aStr);
    const b = Number(bStr);
    if (!byPersonId.has(a) || !byPersonId.has(b)) continue;
    const aList = nextSiblings.get(a) || [];
    const bList = nextSiblings.get(b) || [];
    if (!aList.includes(b)) aList.push(b);
    if (!bList.includes(a)) bList.push(a);
    nextSiblings.set(a, aList);
    nextSiblings.set(b, bList);
  }

  let updatedNodes = 0;

  for (const r of rows as any[]) {
    const pid = toNum((r as any).personId);
    if (pid === null) continue;

    const parents = (nextParents.get(pid) || []).slice().sort((a, b) => a - b);
    const children = (nextChildren.get(pid) || []).slice().sort((a, b) => a - b);
    const spouses = (nextSpouses.get(pid) || []).slice().sort((a, b) => a - b);
    const siblings = (nextSiblings.get(pid) || []).slice().sort((a, b) => a - b);

    const curParents = normalizeIdList((r as any).parents).filter((x) => x !== pid && byPersonId.has(x)).sort((a, b) => a - b);
    const curChildren = normalizeIdList((r as any).children).filter((x) => x !== pid && byPersonId.has(x)).sort((a, b) => a - b);
    const curSpouses = normalizeIdList((r as any).spouses).filter((x) => x !== pid && byPersonId.has(x)).sort((a, b) => a - b);
    const curSiblings = normalizeIdList((r as any).siblings).filter((x) => x !== pid && byPersonId.has(x)).sort((a, b) => a - b);

    const needsUpdate =
      !arraysEqual(curParents, parents) ||
      !arraysEqual(curChildren, children) ||
      !arraysEqual(curSpouses, spouses) ||
      !arraysEqual(curSiblings, siblings);

    if (!needsUpdate) continue;

    await (r as any).update(
      {
        parents,
        children,
        spouses,
        siblings,
      } as any,
      { transaction },
    );

    updatedNodes++;
  }

  return {
    familyCode,
    totalNodes: rows.length,
    updatedNodes,
    removedParentEdges,
    removedSpouseEdges,
    removedSiblingEdges,
  };
}
