"""
Discovery reach: how much of a stated space of possible signals survives an
instrument's filter and becomes recordable at all.

The quantity every experiment publishes is efficiency FOR THE SIGNAL IT
SEARCHED FOR. This module computes the complement: given a filter policy and an
explicit prior over what could be out there, what fraction of that space is
structurally incapable of reaching a human, and what shape does the lost region
have.

Reach is only defined relative to a stated measure over signal space. That is
not a weakness to be hidden - it is the honest content of the claim, and
`SignalSpace.prior_note` is a required field for exactly that reason.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Callable, Iterable, Literal, Sequence

import numpy as np

Table = dict[str, np.ndarray]


# --------------------------------------------------------------------------
# signal spaces
# --------------------------------------------------------------------------

AxisKind = Literal["log", "lin", "int", "cat"]


@dataclass(frozen=True)
class Axis:
    """One parameter of the space of things that could exist."""

    name: str
    kind: AxisKind
    lo: float = 0.0
    hi: float = 1.0
    unit: str = ""
    values: tuple = ()
    note: str = ""

    def draw(self, n: int, rng: np.random.Generator) -> np.ndarray:
        if self.kind == "log":
            if self.lo <= 0:
                raise ValueError(f"axis {self.name!r}: log axis needs lo > 0")
            return np.exp(rng.uniform(np.log(self.lo), np.log(self.hi), n))
        if self.kind == "lin":
            return rng.uniform(self.lo, self.hi, n)
        if self.kind == "int":
            return rng.integers(int(self.lo), int(self.hi) + 1, n).astype(float)
        if self.kind == "cat":
            return rng.integers(0, len(self.values), n).astype(float)
        raise ValueError(f"unknown axis kind {self.kind!r}")

    def describe(self, lo: float, hi: float) -> str:
        u = f" {self.unit}" if self.unit else ""
        if self.kind == "int":
            return f"{self.name} in [{int(round(lo))}, {int(round(hi))}]{u}"
        fmt = "{:.3g}"
        return f"{self.name} in [{fmt.format(lo)}, {fmt.format(hi)}]{u}"


@dataclass
class SignalSpace:
    """
    A stated space of things that could be out there, plus the map from those
    parameters to what an instrument would actually observe.

    `prior_note` must say, in words, what measure this places on possibility
    and why. Reach numbers are meaningless without it.
    """

    name: str
    axes: Sequence[Axis]
    derive: Callable[[Table], Table]
    prior_note: str
    description: str = ""

    def sample(self, n: int, seed: int = 0) -> tuple[Table, np.ndarray]:
        """Monte Carlo draw. Returns (table of parameters + observables, weights)."""
        rng = np.random.default_rng(seed)
        table: Table = {ax.name: ax.draw(n, rng) for ax in self.axes}
        table.update(self.derive(table))
        weights = np.full(n, 1.0 / n)
        return table, weights

    @property
    def axis_names(self) -> list[str]:
        return [ax.name for ax in self.axes]


@dataclass
class EnumeratedSpace:
    """
    A space small enough to write down completely, so reach is exact rather
    than estimated. Molecular formula spaces are the motivating case.
    """

    name: str
    table: Table
    prior_note: str
    axes: Sequence[Axis] = ()
    description: str = ""
    weights: np.ndarray | None = None

    def sample(self, n: int = 0, seed: int = 0) -> tuple[Table, np.ndarray]:
        size = len(next(iter(self.table.values())))
        w = self.weights if self.weights is not None else np.full(size, 1.0 / size)
        return self.table, w / w.sum()

    @property
    def axis_names(self) -> list[str]:
        return [ax.name for ax in self.axes]


# --------------------------------------------------------------------------
# filter algebra
# --------------------------------------------------------------------------


class Node:
    """A filter is a tree. Leaves test; All conjoins; Any is a menu of paths."""

    name: str
    rationale: str

    def evaluate(self, table: Table) -> np.ndarray:
        raise NotImplementedError

    def walk(self, parent: "Node | None" = None
             ) -> Iterable[tuple["Node", "Node | None"]]:
        yield self, parent

    def spec(self) -> dict:
        raise NotImplementedError


@dataclass
class Cut(Node):
    """
    One irreversible decision. `rationale` records the belief that motivated
    it - which is the whole point, because that belief is the source of the
    blindness.
    """

    name: str
    fn: Callable[[Table], np.ndarray]
    rationale: str = ""
    uses: tuple[str, ...] = ()

    def evaluate(self, table: Table) -> np.ndarray:
        return np.asarray(self.fn(table), dtype=bool)

    def walk(self, parent=None):
        yield self, parent

    def spec(self) -> dict:
        return {"kind": "cut", "name": self.name, "rationale": self.rationale,
                "uses": list(self.uses)}


@dataclass
class All(Node):
    """Conjunction: every child must pass. One trigger path, one QC chain."""

    name: str
    children: Sequence[Node]
    rationale: str = ""

    def evaluate(self, table: Table) -> np.ndarray:
        out = np.ones(_size(table), dtype=bool)
        for c in self.children:
            out &= c.evaluate(table)
        return out

    def walk(self, parent=None):
        yield self, parent
        for c in self.children:
            yield from c.walk(self)

    def spec(self) -> dict:
        return {"kind": "all", "name": self.name, "rationale": self.rationale,
                "children": [c.spec() for c in self.children]}


@dataclass
class Any_(Node):
    """Disjunction: any child suffices. A trigger menu, a panel of assays."""

    name: str
    children: Sequence[Node]
    rationale: str = ""

    def evaluate(self, table: Table) -> np.ndarray:
        out = np.zeros(_size(table), dtype=bool)
        for c in self.children:
            out |= c.evaluate(table)
        return out

    def walk(self, parent=None):
        yield self, parent
        for c in self.children:
            yield from c.walk(self)

    def spec(self) -> dict:
        return {"kind": "any", "name": self.name, "rationale": self.rationale,
                "children": [c.spec() for c in self.children]}


def _size(table: Table) -> int:
    return len(next(iter(table.values())))


@dataclass
class Filter:
    """A named, hashable filter policy."""

    name: str
    root: Node
    description: str = ""

    def evaluate(self, table: Table) -> np.ndarray:
        return self.root.evaluate(table)

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description,
                "root": self.root.spec()}

    def fingerprint(self) -> str:
        blob = json.dumps(self.spec(), sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()[:16]

    # -- counterfactuals ---------------------------------------------------

    def relax(self, target: str) -> "Filter":
        """Force a named node to always pass. Reveals the cost of a requirement."""
        return Filter(f"{self.name}[relax:{target}]",
                      _rewrite(self.root, target, "relax"), self.description)

    def ablate(self, target: str) -> "Filter":
        """Delete a named node. Reveals the unique contribution of a path."""
        return Filter(f"{self.name}[ablate:{target}]",
                      _rewrite(self.root, target, "ablate"), self.description)


_ALWAYS = Cut("always", lambda t: np.ones(_size(t), dtype=bool), "forced open")
_NEVER = Cut("never", lambda t: np.zeros(_size(t), dtype=bool), "removed")


def _rewrite(node: Node, target: str, mode: str) -> Node:
    if node.name == target:
        return _ALWAYS if mode == "relax" else _NEVER
    if isinstance(node, All):
        return All(node.name, [_rewrite(c, target, mode) for c in node.children],
                   node.rationale)
    if isinstance(node, Any_):
        return Any_(node.name, [_rewrite(c, target, mode) for c in node.children],
                    node.rationale)
    return node


# --------------------------------------------------------------------------
# the audit
# --------------------------------------------------------------------------


@dataclass
class NodeStat:
    name: str
    kind: str
    parent: str | None
    rationale: str
    coverage: float          # fraction of the space this node alone admits
    exclusive: float         # admitted by this node and no sibling (Any children)
    cost: float              # reach recovered if this requirement is lifted (All children)


@dataclass
class Audit:
    space_name: str
    filter_name: str
    filter_fingerprint: str
    prior_note: str
    reach: float
    n: int
    exact: bool
    table: Table = field(repr=False, default_factory=dict)
    survives: np.ndarray = field(repr=False, default=None)
    weights: np.ndarray = field(repr=False, default=None)
    nodes: list[NodeStat] = field(default_factory=list)

    @property
    def blind(self) -> float:
        return 1.0 - self.reach


def audit(space, filt: Filter, n: int = 200_000, seed: int = 0,
          attribute: bool = True, cached: tuple | None = None) -> Audit:
    """
    Compute discovery reach, and attribute the loss to individual decisions.

    `attribute=False` skips the per-node counterfactuals, which dominate the
    cost; robustness sweeps run thousands of audits and only need the scalar.
    `cached` accepts a pre-drawn (table, weights) so a sweep over filter
    parameters does not redraw or re-enumerate the space each time.
    """
    table, weights = cached if cached is not None else space.sample(n, seed)
    survives = filt.evaluate(table)
    reach = float(weights[survives].sum())

    if not attribute:
        return Audit(
            space_name=space.name, filter_name=filt.name,
            filter_fingerprint=filt.fingerprint(), prior_note=space.prior_note,
            reach=reach, n=_size(table),
            exact=isinstance(space, EnumeratedSpace),
            table=table, survives=survives, weights=weights, nodes=[],
        )

    parents: dict[str, Node | None] = {}
    seen: dict[str, Node] = {}
    for node, parent in filt.root.walk():
        if node.name in seen:
            continue
        seen[node.name] = node
        parents[node.name] = parent

    stats: list[NodeStat] = []
    for name, node in seen.items():
        parent = parents[name]
        cov = float(weights[node.evaluate(table)].sum())
        excl = float("nan")
        cost = float("nan")
        if isinstance(parent, Any_):
            without = filt.ablate(name)
            excl = reach - float(weights[without.evaluate(table)].sum())
        if isinstance(parent, All):
            loosened = filt.relax(name)
            cost = float(weights[loosened.evaluate(table)].sum()) - reach
        stats.append(NodeStat(
            name=name,
            kind=type(node).__name__.rstrip("_").lower(),
            parent=parent.name if parent else None,
            rationale=node.rationale,
            coverage=cov, exclusive=excl, cost=cost,
        ))

    return Audit(
        space_name=space.name,
        filter_name=filt.name,
        filter_fingerprint=filt.fingerprint(),
        prior_note=space.prior_note,
        reach=reach,
        n=_size(table),
        exact=isinstance(space, EnumeratedSpace),
        table=table, survives=survives, weights=weights, nodes=stats,
    )
