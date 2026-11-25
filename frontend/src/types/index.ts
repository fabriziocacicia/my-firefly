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

export interface Tag {
  id: number;
  name: string;
  group: string;
  color: string;
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
  default_unit: string;
  package_size: number;
  notes?: string;
  brand?: Brand;
  tags: Tag[];
}

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
  quantity: number;
  unit: string;
  package_size?: number;
  normalized_unit_price?: number;
  normalized_regular_price?: number;
  firefly_transaction_id?: number;
  notes?: string;
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
  quantity: number;
  unit: MeasureUnit;
  package_size: number;
  paid_price: number;
  regular_price?: number;
  is_discount: boolean;
  line_total: number;
}

export interface ReceiptItemPayload {
  product_id: number;
  quantity: number;
  unit: MeasureUnit;
  package_size: number;
  paid_price: number;
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
