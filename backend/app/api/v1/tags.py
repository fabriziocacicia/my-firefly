from typing import List
import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.database import get_session
from app.models.tag import (
    Tag,
    TagCreate,
    TagImplication,
    TagImplicationCreate,
    TagImplicationRead,
    TagRead,
)
from app.services.firefly import firefly_client
from app.services.taxonomy import get_implication_map, would_create_cycle

router = APIRouter(prefix="/tags", tags=["Tags & Classification"])


class TagSyncResponse(BaseModel):
    synced_count: int
    created_count: int
    updated_count: int
    tags: List[TagRead]


def _extract_firefly_tag_pair(raw: dict) -> tuple[int, str] | None:
    try:
        ff_id = int(raw.get("id"))
    except (TypeError, ValueError):
        return None
    name = str(raw.get("attributes", {}).get("tag") or "").strip()
    if not name:
        return None
    return ff_id, name


@router.get("/", response_model=list[TagRead])
def list_tags(group: str | None = None, session: Session = Depends(get_session)):
    query = select(Tag)
    if group:
        query = query.where(Tag.group == group)
    tags = session.exec(query).all()
    tags.sort(key=lambda t: t.name.lower())
    return tags


@router.post("/sync-firefly", response_model=TagSyncResponse)
async def sync_firefly_tags(session: Session = Depends(get_session)):
    """
    Syncs tags from Firefly III matching permanently by `firefly_tag_id` first
    (preserving TagImplication edges across renames), then by case-insensitive name.
    """
    try:
        raw_ff_tags = await firefly_client.get_all_tags()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to reach Firefly III to sync tags: {exc}",
        ) from exc

    existing_tags = session.exec(select(Tag)).all()
    by_ff_id = {t.firefly_tag_id: t for t in existing_tags if t.firefly_tag_id is not None}
    by_lower_name = {t.name.strip().lower(): t for t in existing_tags}

    created_count = 0
    updated_count = 0

    for raw in raw_ff_tags:
        pair = _extract_firefly_tag_pair(raw)
        if not pair:
            continue
        ff_id, ff_name = pair
        lower_name = ff_name.lower()

        if ff_id in by_ff_id:
            tag = by_ff_id[ff_id]
            if tag.name != ff_name:
                # Avoid unique constraint collision if another unlinked tag already has ff_name
                old_lower = tag.name.strip().lower()
                if lower_name not in by_lower_name or by_lower_name[lower_name].id == tag.id:
                    by_lower_name.pop(old_lower, None)
                    tag.name = ff_name
                    by_lower_name[lower_name] = tag
                    session.add(tag)
                    updated_count += 1
        elif lower_name in by_lower_name:
            tag = by_lower_name[lower_name]
            changed = False
            if tag.firefly_tag_id != ff_id:
                tag.firefly_tag_id = ff_id
                by_ff_id[ff_id] = tag
                changed = True
            if tag.name != ff_name:
                tag.name = ff_name
                changed = True
            if changed:
                session.add(tag)
                updated_count += 1
        else:
            tag = Tag(name=ff_name, firefly_tag_id=ff_id)
            session.add(tag)
            session.flush()
            by_ff_id[ff_id] = tag
            by_lower_name[lower_name] = tag
            created_count += 1

    session.commit()
    all_tags = session.exec(select(Tag)).all()
    all_tags.sort(key=lambda t: t.name.lower())
    return TagSyncResponse(
        synced_count=len(all_tags),
        created_count=created_count,
        updated_count=updated_count,
        tags=all_tags,
    )


@router.post("/", response_model=TagRead)
async def create_tag(tag_in: TagCreate, session: Session = Depends(get_session)):
    clean_name = tag_in.name.strip()
    if not clean_name:
        raise HTTPException(status_code=422, detail="Tag name cannot be empty")

    existing_tags = session.exec(select(Tag)).all()
    existing = next(
        (t for t in existing_tags if t.name.strip().lower() == clean_name.lower()),
        None,
    )
    if existing and existing.firefly_tag_id is not None:
        return existing

    # Ensure the tag exists in Firefly III so every tag carries a permanent firefly_tag_id
    ff_id: int | None = existing.firefly_tag_id if existing else None
    ff_name = clean_name
    if ff_id is None:
        try:
            ff_tags = await firefly_client.get_all_tags()
            for raw in ff_tags:
                pair = _extract_firefly_tag_pair(raw)
                if pair and pair[1].lower() == clean_name.lower():
                    ff_id, ff_name = pair
                    break
            if ff_id is None:
                created_resp = await firefly_client.create_tag(clean_name)
                pair = _extract_firefly_tag_pair(created_resp.get("data", {}))
                if not pair:
                    raise HTTPException(
                        status_code=502,
                        detail="Firefly III returned an unexpected response when creating the tag.",
                    )
                ff_id, ff_name = pair
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Unable to create tag in Firefly III: {exc}",
            ) from exc

    if existing:
        existing.firefly_tag_id = ff_id
        existing.name = ff_name
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return existing

    tag = Tag(
        name=ff_name,
        firefly_tag_id=ff_id,
        group=tag_in.group,
        color=tag_in.color,
    )
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag


@router.get("/implications", response_model=list[TagImplicationRead])
def list_tag_implications(session: Session = Depends(get_session)):
    return session.exec(select(TagImplication)).all()


@router.post("/implications", response_model=TagImplicationRead)
def create_tag_implication(
    imp_in: TagImplicationCreate, session: Session = Depends(get_session)
):
    child = session.get(Tag, imp_in.child_tag_id)
    parent = session.get(Tag, imp_in.parent_tag_id)
    if not child or not parent:
        raise HTTPException(status_code=404, detail="Child or parent tag not found")

    existing = session.get(
        TagImplication, (imp_in.child_tag_id, imp_in.parent_tag_id)
    )
    if existing:
        return existing

    implications = get_implication_map(session)
    if would_create_cycle(imp_in.child_tag_id, imp_in.parent_tag_id, implications):
        raise HTTPException(
            status_code=422,
            detail=f"Adding '{child.name} -> {parent.name}' would create a tag hierarchy cycle",
        )

    implication = TagImplication(
        child_tag_id=imp_in.child_tag_id,
        parent_tag_id=imp_in.parent_tag_id,
    )
    session.add(implication)
    session.commit()
    return implication


@router.delete("/implications/{child_tag_id}/{parent_tag_id}", status_code=204)
def delete_tag_implication(
    child_tag_id: int,
    parent_tag_id: int,
    session: Session = Depends(get_session),
):
    existing = session.get(TagImplication, (child_tag_id, parent_tag_id))
    if not existing:
        raise HTTPException(status_code=404, detail="Tag implication not found")
    session.delete(existing)
    session.commit()
    return Response(status_code=204)
