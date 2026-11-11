from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.core.database import get_session
from app.models.tag import Tag, TagCreate, TagRead

router = APIRouter(prefix="/tags", tags=["Tags & Classification"])

@router.get("/", response_model=list[TagRead])
def list_tags(group: str | None = None, session: Session = Depends(get_session)):
    query = select(Tag)
    if group:
        query = query.where(Tag.group == group)
    return session.exec(query).all()

@router.post("/", response_model=TagRead)
def create_tag(tag_in: TagCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Tag).where(Tag.name == tag_in.name)).first()
    if existing:
        return existing
    tag = Tag.from_orm(tag_in)
    session.add(tag)
    session.commit()
    session.refresh(tag)
    return tag
