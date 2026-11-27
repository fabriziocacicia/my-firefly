export type AppTab = 'stores' | 'accounts-and-chains' | 'catalog' | 'workflows' | 'workbench';

export type AccountRole =
  | 'unclassified'
  | 'person'
  | 'chain'
  | 'local_business'
  | 'physical_store'
  | 'ecommerce'
  | 'service'
  | 'independent';

export interface AccountMetadata {
  firefly_account_id: number;
  role: AccountRole;
  category?: string | null;
  is_inherited_category?: boolean;
  business_types?: string[];
  inherited_business_types?: string[];
  effective_business_types?: string[];
  company_id?: number | null;
  company_name?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AccountMetadataUpdate {
  role: AccountRole;
  category?: string | null;
  business_types?: string[];
  company_id?: number | null;
  notes?: string | null;
}

export type SaleMode = 'packaged' | 'loose_weight';

export interface Tag {
  id: number;
  name: string;
  firefly_tag_id?: number | null;
  group: string;
  color: string;
}

export interface TagImplication {
  child_tag_id: number;
  parent_tag_id: number;
}

export type ImplicationImpactAction = 'add' | 'remove';

export interface ImplicationImpactItem {
  product_id: number;
  product_name: string;
  before_tags: string[];
  after_tags: string[];
  affected_firefly_transactions: number;
  affected_firefly_splits: number;
  has_active_sync_job: boolean;
}

export interface ImplicationImpactResponse {
  action: ImplicationImpactAction;
  child_tag_id: number;
  parent_tag_id: number;
  child_tag_name: string;
  parent_tag_name: string;
  affected_items: ImplicationImpactItem[];
  total_affected_items: number;
  total_affected_transactions: number;
  total_affected_splits: number;
}

export interface TagSyncResponse {
  synced_count: number;
  created_count: number;
  updated_count: number;
  tags: Tag[];
}

export interface FireflyCategoryBrief {
  id: number;
  name: string;
}

export interface ItemFireflyAlias {
  id: number;
  product_id: number;
  raw_description: string;
  normalized_description: string;
  company_id?: number | null;
  firefly_account_id?: number | null;
  scope_key?: string;
  created_at: string;
}

export interface Brand {
  id: number;
  name: string;
  is_private_label: boolean;
  notes?: string;
}

export interface Company {
  id: number;
  name: string;
  default_category?: string;
  business_types?: string[];
  notes?: string;
  store_count?: number;
}

export interface Product {
  id: number;
  name: string;
  brand_id?: number;
  barcode?: string;
  sale_mode: SaleMode;
  pack_count: number;
  unit_size: number;
  default_unit: string;
  package_size: number;
  firefly_category_id?: number | null;
  firefly_category_name?: string | null;
  notes?: string;
  brand?: Brand;
  tags: Tag[];
  effective_tags?: Tag[];
  aliases?: ItemFireflyAlias[];
  affected_firefly_count?: number;
  firefly_description?: string;
}

export type VerificationStatus = 'missing' | 'needs_review' | 'verified';

export interface PriceRecord {
  id: number;
  product_id: number;
  firefly_account_id: number;
  store_name?: string;
  recorded_date: string;
  regular_price: number;
  paid_price: number;
  is_discount: boolean;
  discount_type?: string;
  discount_note?: string;
  quantity: number | null;
  unit: string;
  package_size?: number | null;
  normalized_unit_price?: number | null;
  normalized_regular_price?: number | null;
  firefly_transaction_id?: number | null;
  transaction_journal_id?: number | null;
  source_type?: string;
  verification_status?: VerificationStatus;
  notes?: string | null;
  product?: Product;
}

export interface DealAnalysis {
  current_price: number;
  regular_price: number;
  discount_pct: number;
  all_time_low: number;
  baseline_regular_price: number;
  deal_rating: 'ALL_TIME_LOW' | 'GREAT_DEAL' | 'GOOD_DEAL' | 'REGULAR';
  normalized_current_price?: number | null;
  normalized_all_time_low?: number | null;
  normalized_baseline_regular_price?: number | null;
}

export interface FireflyExpenseAccountBrief {
  id: number;
  name: string;
}

export interface FireflyExpenseAccount {
  id: number;
  name: string;
  active: boolean;
  role?: AccountRole;
  category?: string | null;
  is_inherited_category?: boolean;
  business_types?: string[];
  inherited_business_types?: string[];
  effective_business_types?: string[];
  company_id?: number | null;
  company_name?: string | null;
}

export const COMMON_BUSINESS_TYPES = [
  'Supermarket',
  'Bar/Cafe',
  'Restaurant',
  'Pharmacy',
  'Tobacconist',
  'Bakery',
  'Gas Station',
  'Carwash',
  'Gym',
  'Hairdresser',
  'Florist',
  'Bookstore',
  'Electronics',
  'Clothing',
  'Pet Shop',
  'Hardware Store',
  'Dry Cleaner',
  'Airport',
  'Nightclub',
  'Hotel',
] as const;

export type AssetAccountType =
  | 'standard'
  | 'bank_account'
  | 'cash'
  | 'digital_credit'
  | 'investment_account'
  | 'meal_voucher';

export interface FireflyAssetAccount {
  id: number;
  name: string;
  current_balance: string;
  active?: boolean;
  include_net_worth?: boolean;
  currency_code?: string | null;
  asset_type: AssetAccountType;
  voucher_unit_value?: number | null;
  default_revenue_account_id?: number | null;
  default_revenue_account_name?: string | null;
  default_recharge_description?: string | null;
  notes?: string | null;
  usable_vouchers?: number | null;
  is_exact_multiple: boolean;
  balance_discrepancy: number;
}

export interface FireflyRevenueAccount {
  id: number;
  name: string;
}

export interface AssetAccountMetadataUpdate {
  asset_type: AssetAccountType;
  voucher_unit_value?: number | null;
  default_revenue_account_id?: number | null;
  default_recharge_description?: string | null;
  notes?: string | null;
}

export interface VoucherRechargeRequest {
  count: number;
  recharge_date: string;
  recharge_time: string;
  revenue_account_id?: number | null;
  description?: string | null;
  notes?: string | null;
}

export interface VoucherRechargeResponse {
  firefly_transaction_id: number;
  account_id: number;
  revenue_account_id: number;
  count: number;
  unit_value: number;
  amount: number;
  current_balance: string;
  usable_vouchers: number;
  is_exact_multiple: boolean;
  balance_discrepancy: number;
}

export type MeasureUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
export type PaymentMode = 'single' | 'split_vouchers';
export type EntryMode = 'grid' | 'stream';

export interface DraftReceiptItem {
  temp_id: string;
  product_id: number;
  product_name: string;
  brand_name?: string;
  sale_mode?: SaleMode;
  pack_count?: number;
  unit_size?: number;
  firefly_category_name?: string | null;
  effective_tag_names?: string[];
  quantity: number;
  unit: MeasureUnit;
  package_size: number;
  paid_price: number;
  total_price?: number;
  regular_price?: number;
  is_discount: boolean;
  line_total: number;
}

export interface ReceiptItemPayload {
  product_id: number;
  quantity: number;
  unit?: MeasureUnit;
  package_size?: number;
  paid_price?: number;
  total_price?: number;
  regular_price?: number;
  is_discount: boolean;
}

export interface ReceiptCreatePayload {
  firefly_account_id: number;
  purchase_date: string;
  purchase_time: string;
  basket_discount: number;
  source_account_id?: number | null;
  payment_mode: PaymentMode;
  voucher_account_id?: number | null;
  voucher_count: number;
  voucher_unit_value: number;
  notes?: string;
  items: ReceiptItemPayload[];
}

export interface ReceiptAttachment {
  id: number;
  receipt_id: number;
  filename: string;
  stored_path: string;
  file_type: string;
  file_size_bytes: number;
  sha256_hash: string;
  uploaded_at: string;
}

export interface ReceiptItemRecord {
  id: number;
  receipt_id: number;
  product_id: number;
  quantity: number;
  unit: string;
  package_size: number;
  paid_price: number;
  regular_price?: number | null;
  is_discount: boolean;
  line_total: number;
  product?: Product;
}

export interface ReceiptRecord {
  id: number;
  firefly_account_id: number;
  store_name?: string;
  purchase_date: string;
  purchase_time?: string | null;
  total_amount: number;
  basket_discount: number;
  source_account_id?: number | null;
  payment_mode: PaymentMode;
  voucher_account_id?: number | null;
  voucher_count: number;
  voucher_unit_value: number;
  firefly_transaction_id?: number | null;
  firefly_voucher_transaction_id?: number | null;
  notes?: string | null;
  created_at: string;
  items: ReceiptItemRecord[];
  attachments: ReceiptAttachment[];
}

export interface ProductPriceHistoryResponse {
  product_id: number;
  product_name: string;
  brand?: string | null;
  default_unit: string;
  analysis: DealAnalysis | null;
  records: PriceRecord[];
}

export interface FireflySyncStatus {
  last_full_sync_at?: string | null;
  last_incremental_sync_at?: string | null;
  high_watermark_date?: string | null;
  total_cached_splits: number;
  unassociated_count: number;
  linked_count?: number;
  ignored_count: number;
  needs_attention_count?: number;
}

export interface SyncTransactionsResponse {
  status: 'synced' | 'skipped_cooldown' | 'requires_full_sync';
  mode: 'incremental' | 'full';
  splits_upserted: number;
  last_full_sync_at?: string | null;
  last_incremental_sync_at?: string | null;
  high_watermark_date?: string | null;
}

export interface CategoryBacklogCount {
  category_name: string | null;
  count: number;
}

export interface ChainFilterOption {
  id: number;
  name: string;
  count: number;
}

export interface StoreFilterOption {
  account_id: number;
  name: string;
  company_id?: number | null;
  count: number;
}

export type BacklogStatusFilter = 'unassociated' | 'needs_attention' | 'linked' | 'ignored';
export type AliasScope = 'auto' | 'global' | 'chain' | 'store' | 'none';

export interface BacklogGroup {
  normalized_description: string;
  sample_description: string;
  category_name: string | null;
  occurrence_count: number;
  total_amount: number;
  latest_date: string;
  sample_stores: string[];
  sample_tags?: string[];
  journal_ids: number[];
  suggested_product_id?: number | null;
  suggested_product_name?: string | null;
  suggested_scope?: string | null;
  linked_product_id?: number | null;
  linked_product_name?: string | null;
  chain_count?: number;
  store_count?: number;
}

export interface BacklogResponse {
  total_unassociated: number;
  linked_count: number;
  ignored_count: number;
  needs_attention_count?: number;
  category_counts: CategoryBacklogCount[];
  available_chains?: ChainFilterOption[];
  available_stores?: StoreFilterOption[];
  groups: BacklogGroup[];
}

export interface AttentionSplitItem {
  price_record_id: number;
  product_id: number;
  product_name: string;
  brand_name?: string | null;
  sale_mode: SaleMode;
  default_unit: string;
  transaction_journal_id?: number | null;
  firefly_transaction_id?: number | null;
  split_description?: string | null;
  category_name?: string | null;
  firefly_account_id: number;
  store_name: string;
  company_id?: number | null;
  company_name?: string | null;
  recorded_date: string;
  paid_price: number;
  regular_price: number;
  is_discount: boolean;
  quantity: number | null;
  unit: string;
  package_size?: number | null;
  normalized_unit_price?: number | null;
  normalized_regular_price?: number | null;
  verification_status: VerificationStatus;
  notes?: string | null;
}

export interface AttentionQueueResponse {
  missing_count: number;
  needs_review_count: number;
  available_chains: ChainFilterOption[];
  available_stores: StoreFilterOption[];
  items: AttentionSplitItem[];
}

export interface SplitPriceSummary {
  id: number;
  quantity: number | null;
  unit: string;
  package_size?: number | null;
  regular_price: number;
  paid_price: number;
  is_discount: boolean;
  normalized_unit_price?: number | null;
  normalized_regular_price?: number | null;
  verification_status: VerificationStatus;
  notes?: string | null;
}

export interface BacklogSplitDetail {
  transaction_journal_id: number;
  firefly_transaction_id: number;
  tx_date: string;
  amount: number;
  description: string;
  tags: string[];
  linked_product_id?: number | null;
  linked_product_name?: string | null;
  is_ignored: boolean;
  price_record?: SplitPriceSummary | null;
}

export interface BacklogStoreBucket {
  firefly_account_id?: number | null;
  store_name: string;
  company_id?: number | null;
  occurrence_count: number;
  total_amount: number;
  journal_ids: number[];
  suggested_product_id?: number | null;
  suggested_product_name?: string | null;
  suggested_scope?: string | null;
  splits: BacklogSplitDetail[];
}

export interface BacklogChainBucket {
  company_id: number;
  company_name: string;
  occurrence_count: number;
  total_amount: number;
  journal_ids: number[];
  suggested_product_id?: number | null;
  suggested_product_name?: string | null;
  suggested_scope?: string | null;
  stores: BacklogStoreBucket[];
}

export interface BacklogSplitsResponse {
  normalized_description: string;
  category_name?: string | null;
  status: 'unassociated' | 'linked' | 'ignored';
  occurrence_count: number;
  total_amount: number;
  chains: BacklogChainBucket[];
  unchained_stores: BacklogStoreBucket[];
}

export interface FailedTransactionRewrite {
  firefly_transaction_id: number;
  error: string;
  split_count?: number;
}

export type FireflySyncJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed';

export type FireflySyncJobType = 'backlog_link' | 'product_propagate';

export interface FireflySyncJob {
  id: number;
  job_type: FireflySyncJobType;
  product_id: number;
  product_name: string;
  status: FireflySyncJobStatus;
  total_transactions: number;
  processed_transactions: number;
  updated_transactions: number;
  total_splits: number;
  processed_splits: number;
  linked_splits: number;
  updated_splits: number;
  failed_count: number;
  failed_transactions: FailedTransactionRewrite[];
  target_journal_ids: number[];
  error_message?: string | null;
  dismissed_at?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface BatchPropagateResponse {
  jobs: FireflySyncJob[];
  skipped_active_product_ids: number[];
}

export interface ItemAnalyticsSummary {
  product_id: number;
  product_name: string;
  brand_name?: string | null;
  firefly_category_name?: string | null;
  sale_mode: SaleMode;
  default_unit: string;
  effective_tag_names: string[];
  total_spend: number;
  purchase_count: number;
  min_unit_price?: number | null;
  median_unit_price?: number | null;
  latest_unit_price?: number | null;
  normalized_unit_label: string;
}

export interface TagAnalyticsResponse {
  total_spend: number;
  total_purchases: number;
  matching_item_count: number;
  applied_tags: Tag[];
  items: ItemAnalyticsSummary[];
}
