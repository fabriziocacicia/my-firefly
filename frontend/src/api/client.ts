import {
  Company, Store, Product, Brand, Tag, PriceRecord,
  FireflyExpenseAccount, FireflyAssetAccount,
  ProductPriceHistoryResponse, ReceiptCreatePayload, ReceiptRecord, ReceiptAttachment
} from '../types';

const BASE_URL = '/api/v1';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const defaultHeaders: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorBody.detail || `HTTP Error ${res.status}`);
  }

  return res.json();
}

export const api = {
  firefly: {
    getStatus: () => request<{ connected: boolean; version?: string; error?: string; url: string }>('/firefly/status'),
    getExpenseAccounts: () => request<FireflyExpenseAccount[]>('/firefly/expense-accounts'),
    getAssetAccounts: () => request<FireflyAssetAccount[]>('/firefly/asset-accounts'),
  },

  companies: {
    list: () => request<Company[]>('/companies/'),
    create: (data: { name: string; default_category?: string }) =>
      request<Company>('/companies/', { method: 'POST', body: JSON.stringify(data) }),
    listStores: (companyId?: number) =>
      request<Store[]>(companyId ? `/companies/stores?company_id=${companyId}` : '/companies/stores'),
    quickMap: (params: { company_name: string; store_name: string; firefly_account_id: number; firefly_account_name: string }) => {
      const url = `/companies/quick-map?company_name=${encodeURIComponent(params.company_name)}&store_name=${encodeURIComponent(params.store_name)}&firefly_account_id=${params.firefly_account_id}&firefly_account_name=${encodeURIComponent(params.firefly_account_name)}`;
      return request<Store>(url, { method: 'POST' });
    },
  },

  tags: {
    list: (group?: string) => request<Tag[]>(group ? `/tags/?group=${group}` : '/tags/'),
    create: (data: { name: string; group?: string; color?: string }) =>
      request<Tag>('/tags/', { method: 'POST', body: JSON.stringify(data) }),
  },

  products: {
    list: (params?: { search?: string; brand_id?: number; tag_id?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.search) searchParams.append('search', params.search);
      if (params?.brand_id) searchParams.append('brand_id', params.brand_id.toString());
      if (params?.tag_id) searchParams.append('tag_id', params.tag_id.toString());
      return request<Product[]>(`/products/?${searchParams.toString()}`);
    },
    create: (data: {
      name: string;
      brand_id?: number;
      barcode?: string;
      default_unit: string;
      package_size: number;
      tag_ids: number[];
      notes?: string;
    }) => request<Product>('/products/', { method: 'POST', body: JSON.stringify(data) }),
    listBrands: () => request<Brand[]>('/products/brands'),
    createBrand: (data: { name: string; is_private_label?: boolean }) =>
      request<Brand>('/products/brands', { method: 'POST', body: JSON.stringify(data) }),
  },

  prices: {
    record: (data: {
      product_id: number;
      store_id: number;
      recorded_date: string;
      regular_price: number;
      paid_price: number;
      is_discount: boolean;
      discount_type?: string;
      discount_note?: string;
      quantity: number;
      unit: string;
      package_size?: number;
      notes?: string;
    }) => request<PriceRecord>('/prices/', { method: 'POST', body: JSON.stringify(data) }),
    getHistory: (productId: number) =>
      request<ProductPriceHistoryResponse>(`/prices/history/${productId}`),
  },

  receipts: {
    create: (payload: ReceiptCreatePayload) =>
      request<ReceiptRecord>('/receipts/', { method: 'POST', body: JSON.stringify(payload) }),
    uploadAttachment: (receiptId: number, file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return request<ReceiptAttachment>(`/receipts/${receiptId}/attachments`, {
        method: 'POST',
        body: formData,
      });
    },
    getAttachmentUrl: (receiptId: number, attachmentId: number) =>
      `${BASE_URL}/receipts/${receiptId}/attachments/${attachmentId}`,
    list: (limit = 50, offset = 0) =>
      request<ReceiptRecord[]>(`/receipts/?limit=${limit}&offset=${offset}`),
    getById: (id: number) =>
      request<ReceiptRecord>(`/receipts/${id}`),
    pushToFirefly: (id: number, force = false) =>
      request<ReceiptRecord>(`/receipts/${id}/push-to-firefly`, {
        method: 'POST',
        body: JSON.stringify({ force: Boolean(force) }),
      }),
  },

  workflows: {
    mealVoucherSplit: (data: {
      purchase_date: string;
      destination_account_id: number;
      destination_account_name: string;
      ticket_account_id: number;
      ticket_count: number;
      ticket_unit_value: number;
      card_account_id: number;
      total_amount: number;
      description?: string;
    }) => request<any>('/workflows/meal-voucher-split', { method: 'POST', body: JSON.stringify(data) }),

    familyPlan: (data: {
      purchase_date: string;
      service_name: string;
      month_label: string;
      source_account_id: number;
      expense_account_id: number;
      total_amount: number;
      notes?: string;
    }) => request<any>('/workflows/family-plan-entry', { method: 'POST', body: JSON.stringify(data) }),
  },
};
