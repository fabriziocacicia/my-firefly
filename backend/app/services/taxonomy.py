from typing import Iterable
from sqlmodel import Session, select
from app.models.tag import ProductTagLink, Tag, TagImplication


def build_implication_map(implications: Iterable[TagImplication]) -> dict[int, set[int]]:
    """Builds adjacency map: child_tag_id -> set of direct parent_tag_ids."""
    graph: dict[int, set[int]] = {}
    for imp in implications:
        graph.setdefault(imp.child_tag_id, set()).add(imp.parent_tag_id)
    return graph


def get_implication_map(session: Session) -> dict[int, set[int]]:
    """Loads all TagImplication edges from the database into an adjacency map."""
    implications = session.exec(select(TagImplication)).all()
    return build_implication_map(implications)


def get_descendant_tag_ids(
    target_tag_id: int,
    implications: dict[int, set[int]],
) -> set[int]:
    """
    Returns {target_tag_id} union all child/descendant tag IDs that imply `target_tag_id`.
    Used when filtering items by a parent tag (e.g., filtering by 'Frutta' finds 'Mele').
    """
    reverse_graph: dict[int, set[int]] = {}
    for child_id, parents in implications.items():
        for parent_id in parents:
            reverse_graph.setdefault(parent_id, set()).add(child_id)

    matching: set[int] = set()
    stack = [target_tag_id]
    while stack:
        current = stack.pop()
        if current in matching:
            continue
        matching.add(current)
        stack.extend(reverse_graph.get(current, ()))
    return matching


def would_create_cycle(
    child_tag_id: int,
    parent_tag_id: int,
    implications: dict[int, set[int]],
) -> bool:
    """
    Returns True if adding `child_tag_id -> parent_tag_id` would introduce a cycle.
    A cycle occurs if child_tag_id == parent_tag_id or child_tag_id is already an
    ancestor of parent_tag_id.
    """
    if child_tag_id == parent_tag_id:
        return True

    visited: set[int] = set()
    stack = [parent_tag_id]
    while stack:
        current = stack.pop()
        if current == child_tag_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        stack.extend(implications.get(current, ()))
    return False


def expand_tag_ids(
    direct_tag_ids: Iterable[int],
    implications: dict[int, set[int]],
) -> set[int]:
    """Computes transitive closure of direct tags through TagImplication edges."""
    expanded: set[int] = set()
    stack = list(direct_tag_ids)
    while stack:
        current = stack.pop()
        if current in expanded:
            continue
        expanded.add(current)
        stack.extend(implications.get(current, ()))
    return expanded


def expand_tags_ordered(
    direct_tags: list[Tag],
    all_tags_by_id: dict[int, Tag],
    implications: dict[int, set[int]],
) -> list[Tag]:
    """
    Returns direct tags in original order followed by implied ancestor tags
    sorted alphabetically by name, without duplicates.
    """
    direct_ids = [t.id for t in direct_tags if t.id is not None]
    expanded_ids = expand_tag_ids(direct_ids, implications)
    direct_set = set(direct_ids)

    implied_tags = [
        all_tags_by_id[tid]
        for tid in expanded_ids - direct_set
        if tid in all_tags_by_id
    ]
    implied_tags.sort(key=lambda t: t.name.lower())

    seen: set[int] = set()
    ordered: list[Tag] = []
    for tag in [*direct_tags, *implied_tags]:
        if tag.id is not None and tag.id not in seen:
            seen.add(tag.id)
            ordered.append(tag)
    return ordered


def prune_redundant_ancestor_tag_ids(
    tag_ids: Iterable[int],
    implications: dict[int, set[int]],
) -> list[int]:
    """
    Removes tag IDs that are strictly implied ancestors of another tag in `tag_ids`,
    preserving original order and deduplicating.
    """
    ordered = list(dict.fromkeys(tag_ids))
    if len(ordered) <= 1:
        return ordered

    redundant_ancestors: set[int] = set()
    for tid in ordered:
        stack = list(implications.get(tid, ()))
        visited: set[int] = set()
        while stack:
            current = stack.pop()
            if current in visited or current == tid:
                continue
            visited.add(current)
            redundant_ancestors.add(current)
            stack.extend(implications.get(current, ()))

    return [tid for tid in ordered if tid not in redundant_ancestors]


def sanitize_product_tag_links(
    session: Session,
    implications: dict[int, set[int]] | None = None,
) -> int:
    """
    Removes redundant direct ProductTagLink rows where the linked tag is already an
    implied ancestor of another direct tag on the same product. Returns rows removed.
    """
    imp_map = implications if implications is not None else get_implication_map(session)
    if not imp_map:
        return 0

    links = session.exec(select(ProductTagLink)).all()
    by_product: dict[int, list[ProductTagLink]] = {}
    for link in links:
        if link.product_id is not None and link.tag_id is not None:
            by_product.setdefault(link.product_id, []).append(link)

    removed = 0
    for prod_links in by_product.values():
        keep_ids = set(
            prune_redundant_ancestor_tag_ids(
                [l.tag_id for l in prod_links if l.tag_id is not None],
                imp_map,
            )
        )
        for link in prod_links:
            if link.tag_id not in keep_ids:
                session.delete(link)
                removed += 1
    return removed
