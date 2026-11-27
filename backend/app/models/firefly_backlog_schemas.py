from datetime import date
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class CategoryBacklogCount(BaseModel):
    category_name: Optional[str] = None
    count: int


class ChainFilterOption(BaseModel):
    id: int
    name: str
    count: int


class StoreFilterOption(BaseModel):
    account_id: int
    name: str
    company_id: Optional[int] = None
    count: int


class BacklogGroup(BaseModel):
    normalized_description: str
    sample_description: str
    category_name: Optional[str] = None
    occurrence_count: int
    total_amount: float
    latest_date: date
    sample_stores: List[str] = []
    sample_tags: List[str] = []
    journal_ids: List[int] = []
    suggested_product_id: Optional[int] = None
    suggested_product_name: Optional[str] = None
    suggested_scope: Optional[str] = None
    linked_product_id: Optional[int] = None
    linked_product_name: Optional[str] = None
    chain_count: int = 0
    store_count: int = 0


class BacklogResponse(BaseModel):
    total_unassociated: int
    linked_count: int = 0
    ignored_count: int
    needs_attention_count: int = 0
    category_counts: List[CategoryBacklogCount]
    available_chains: List[ChainFilterOption] = []
    available_stores: List[StoreFilterOption] = []
    groups: List[BacklogGroup]


class AttentionSplitItem(BaseModel):
    price_record_id: int
    product_id: int
    product_name: str
    brand_name: Optional[str] = None
    sale_mode: str
    default_unit: str
    transaction_journal_id: Optional[int] = None
    firefly_transaction_id: Optional[int] = None
    split_description: Optional[str] = None
    category_name: Optional[str] = None
    firefly_account_id: int
    store_name: str
    company_id: Optional[int] = None
    company_name: Optional[str] = None
    recorded_date: date
    paid_price: float
    regular_price: float
    is_discount: bool
    quantity: Optional[float] = None
    unit: str
    package_size: Optional[float] = None
    normalized_unit_price: Optional[float] = None
    normalized_regular_price: Optional[float] = None
    verification_status: str
    notes: Optional[str] = None


class AttentionQueueResponse(BaseModel):
    missing_count: int
    needs_review_count: int
    available_chains: List[ChainFilterOption] = []
    available_stores: List[StoreFilterOption] = []
    items: List[AttentionSplitItem]


class SplitPriceSummary(BaseModel):
    id: int
    quantity: Optional[float] = None
    unit: str
    package_size: Optional[float] = None
    regular_price: float
    paid_price: float
    is_discount: bool
    normalized_unit_price: Optional[float] = None
    normalized_regular_price: Optional[float] = None
    verification_status: str
    notes: Optional[str] = None


class BacklogSplitDetail(BaseModel):
    transaction_journal_id: int
    firefly_transaction_id: int
    tx_date: date
    amount: float
    description: str
    tags: List[str] = []
    linked_product_id: Optional[int] = None
    linked_product_name: Optional[str] = None
    is_ignored: bool
    price_record: Optional[SplitPriceSummary] = None


class BacklogStoreBucket(BaseModel):
    firefly_account_id: Optional[int] = None
    store_name: str
    company_id: Optional[int] = None
    occurrence_count: int
    total_amount: float
    journal_ids: List[int] = []
    suggested_product_id: Optional[int] = None
    suggested_product_name: Optional[str] = None
    suggested_scope: Optional[str] = None
    splits: List[BacklogSplitDetail] = []


class BacklogChainBucket(BaseModel):
    company_id: int
    company_name: str
    occurrence_count: int
    total_amount: float
    journal_ids: List[int] = []
    suggested_product_id: Optional[int] = None
    suggested_product_name: Optional[str] = None
    suggested_scope: Optional[str] = None
    stores: List[BacklogStoreBucket] = []


class BacklogSplitsResponse(BaseModel):
    normalized_description: str
    category_name: Optional[str] = None
    status: Literal["unassociated", "linked", "ignored"]
    occurrence_count: int
    total_amount: float
    chains: List[BacklogChainBucket] = []
    unchained_stores: List[BacklogStoreBucket] = []


class BacklogLinkRequest(BaseModel):
    product_id: int
    transaction_journal_ids: List[int] = Field(min_length=1)
    alias_scope: Literal["auto", "global", "chain", "store", "none"] = "auto"


class BacklogIgnoreRequest(BaseModel):
    transaction_journal_ids: List[int] = Field(min_length=1)
    ignored: bool = True


class BacklogUnlinkRequest(BaseModel):
    transaction_journal_ids: List[int] = Field(min_length=1)
