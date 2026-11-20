import {
  Company, Product, Brand, Tag, PriceRecord,
  FireflyExpenseAccount, FireflyExpenseAccountBrief, FireflyAssetAccount,
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
    let message = `HTTP Error ${res.status}`;
    if (typeof errorBody.detail === 'string') {
      message = errorBody.detail;
    } else if (Array.isArray(errorBody.detail)) {
      message = errorBody.detail
        .map((e: any) => (e && typeof e === 'object' ? e.msg || e.detail || JSON.stringify(e) : String(e)))
        .join(', ');
    } else if (errorBody.detail && typeof errorBody.detail === 'object') {
      message = JSON.stringify(errorBody.detail);
    }
    throw new Error(message);
  }

  return res.json();
}

export const api = {
  firefly: {
    getStatus: () => request<{ connected: boolean; version?: string; error?: string; url: string }>('/firefly/status'),
    getExpenseAccounts: () => request<FireflyExpenseAccount[]>('/firefly/expense-accounts'),
    listExpenseAccounts: () => request<FireflyExpenseAccount[]>('/firefly/expense-accounts'),
    searchExpenseAccounts: (query: string, limit: number = 10, signal?: AbortSignal) =>
      request<FireflyExpenseAccountBrief[]>(
        `/firefly/expense-accounts/search?query=${encodeURIComponent(query)}&limit=${limit}`,
        { signal }
      ),
    getExpenseAccount: (id: number) =>
      request<FireflyExpenseAccount>(`/firefly/expense-accounts/${id}`),
    getAssetAccounts: () => request<FireflyAssetAccount[]>('/firefly/asset-accounts'),
  },

  companies: {
    list: () => request<Company[]>('/companies/'),
    create: (data: { name: string; default_category?: string; notes?: string }) =>
      request<Company>('/companies/', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Company>) =>
      request<Company>(`/companies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<void>(`/companies/${id}`, { method: 'DELETE' }),
    assignAccountCompany: (accountId: number, payload: { company_id: number | null }) =>
      request<FireflyExpenseAccount>(`/companies/accounts/${accountId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
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
      firefly_account_id?: number;
      store_id?: number;
      recorded_date: string;
      regular_price: number;
      paid_price: number;
      is_discount: boolean;
      discount_type?: string;
      discount_note?: string;
      quantity: number;
      unit: string;
      package_size?: number;
      normalized_regular_price?: number;
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
