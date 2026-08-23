"""Prerequisite dependency graph.

The dataset expresses prerequisites as a *title* ("Applied VLSI Design"), but
titles are not unique: each rung of each track is offered by several providers,
so one title maps to several ``course_id``s. Resolving a prerequisite to a
single arbitrary course (``.iloc[0]``) is therefore wrong.

The correct unit is the **rung**: ``(branch, track, tier)``. Any variant of the
prerequisite rung satisfies the dependency, so the graph is built over rungs and
course-level prerequisites are derived from rung membership. Prerequisite titles
are resolved *within the same branch and track*, which is what makes the edges
point at the right ladder.

Rungs form a DAG; a topological layering of it gives the roadmap ordering.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx

from app.ml.catalog import Catalog

#: A rung is one step of one track's ladder.
Rung = tuple[str, str, int]


@dataclass
class PrerequisiteGraph:
    """Rung-level dependency DAG with derived course-level views."""

    graph: nx.DiGraph = field(default_factory=nx.DiGraph)
    #: course position -> its rung
    rung_of: dict[int, Rung] = field(default_factory=dict)
    #: rung -> interchangeable course positions
    members: dict[Rung, list[int]] = field(default_factory=dict)
    #: rung -> depth of the longest prerequisite chain reaching it (0 = entry point)
    depth: dict[Rung, int] = field(default_factory=dict)
    #: Prerequisite titles that could not be resolved to a rung.
    unresolved: list[tuple[str, str]] = field(default_factory=list)

    # ------------------------------------------------------------------ #
    def prereq_rungs(self, rung: Rung) -> list[Rung]:
        return list(self.graph.predecessors(rung)) if self.graph.has_node(rung) else []

    def prerequisite_course_ids(self, cat: Catalog, pos: int) -> list[str]:
        """Course ids that satisfy the prerequisite of ``pos`` (any one suffices)."""
        rung = self.rung_of.get(pos)
        if rung is None:
            return []
        out: list[str] = []
        for prereq in self.prereq_rungs(rung):
            out.extend(cat.course_ids[p] for p in self.members.get(prereq, []))
        return out

    def ancestor_rungs(self, rung: Rung) -> set[Rung]:
        """Every rung that must be cleared before ``rung``, transitively."""
        if not self.graph.has_node(rung):
            return set()
        return nx.ancestors(self.graph, rung)

    def chain_to(self, rung: Rung) -> list[Rung]:
        """The full ladder up to and including ``rung``, in learnable order."""
        chain = sorted(self.ancestor_rungs(rung) | {rung}, key=lambda r: (self.depth.get(r, 0), r[2]))
        return chain

    def is_satisfied(self, cat: Catalog, rung: Rung, completed_ids: set[str]) -> bool:
        """True when every prerequisite rung has at least one completed variant."""
        for prereq in self.prereq_rungs(rung):
            member_ids = {cat.course_ids[p] for p in self.members.get(prereq, [])}
            if not (member_ids & completed_ids):
                return False
        return True


def build_prerequisite_graph(cat: Catalog) -> PrerequisiteGraph:
    """Construct the rung DAG from the catalogue's prerequisite titles."""
    pg = PrerequisiteGraph()

    # ---- nodes: one per rung ----
    for (branch, track, tier), positions in cat.variant_index.items():
        rung: Rung = (branch, track, tier)
        pg.members[rung] = list(positions)
        pg.graph.add_node(
            rung,
            branch=branch,
            track=track,
            tier=tier,
            title=cat.df.iloc[positions[0]]["course_title"],
            size=len(positions),
        )
        for p in positions:
            pg.rung_of[p] = rung

    # ---- title -> rung lookup, scoped by (branch, track) ----
    title_lookup: dict[tuple[str, str, str], Rung] = {}
    for rung, positions in pg.members.items():
        branch, track, _ = rung
        for p in positions:
            title_lookup[(branch, track, cat.df.iloc[p]["course_title"].lower())] = rung

    # ---- edges: prerequisite rung -> dependent rung ----
    for rung, positions in pg.members.items():
        branch, track, tier = rung
        prereq_titles = {
            cat.df.iloc[p]["prerequisite_course_title"]
            for p in positions
            if isinstance(cat.df.iloc[p]["prerequisite_course_title"], str)
        }
        for title in prereq_titles:
            target = title_lookup.get((branch, track, title.strip().lower()))
            if target is None:
                # Fall back to the rung one tier below in the same track, which is
                # the dataset's ladder convention, and record the miss.
                pg.unresolved.append((cat.df.iloc[positions[0]]["course_id"], title))
                fallback: Rung = (branch, track, tier - 1)
                target = fallback if pg.graph.has_node(fallback) else None
            if target is not None and target != rung:
                pg.graph.add_edge(target, rung)

    # ---- guarantee acyclicity before layering ----
    if not nx.is_directed_acyclic_graph(pg.graph):
        for cycle in list(nx.simple_cycles(pg.graph)):
            # Break the cycle at its highest-tier -> lowest-tier edge.
            worst = max(
                ((cycle[i], cycle[(i + 1) % len(cycle)]) for i in range(len(cycle))),
                key=lambda e: e[0][2] - e[1][2],
            )
            if pg.graph.has_edge(*worst):
                pg.graph.remove_edge(*worst)

    # ---- longest-path depth per rung ----
    for rung in nx.topological_sort(pg.graph):
        preds = list(pg.graph.predecessors(rung))
        pg.depth[rung] = 1 + max((pg.depth[p] for p in preds), default=-1)

    return pg
