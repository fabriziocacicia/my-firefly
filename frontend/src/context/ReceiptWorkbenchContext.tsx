import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import { api } from '../api/client';
import { DraftReceiptItem, EntryMode, FireflyAssetAccount, PaymentMode } from '../types';

const DRAFT_STORAGE_KEY = 'firefly_receipt_draft';
const FILE_STORAGE_KEY = 'draft_receipt_file';

const round2 = (v: number): number => Math.round(v * 100) / 100;

const todayIso = (): string => new Date().toISOString().split('T')[0];

const nowTimeIso = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const defaultEntryMode = (): EntryMode =>
  typeof window !== 'undefined' && window.innerWidth < 768 ? 'stream' : 'grid';

const createTempId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface PersistedDraft {
  fireflyAccountId: number | null;
  storeName: string;
  storeId?: number | null;
  purchaseDate: string;
  purchaseTime: string;
  basketDiscount: number;
  notes: string;
  sourceAccountId: number | null;
  paymentMode: PaymentMode;
  voucherAccountId: number | null;
  voucherCount: number;
  voucherUnitValue: number;
  draftItems: DraftReceiptItem[];
  savedReceiptId: number | null;
  activeMode: EntryMode;
}

const loadInitialDraft = (): PersistedDraft => {
  const fallback: PersistedDraft = {
    fireflyAccountId: null,
    storeName: '',
    storeId: null,
    purchaseDate: todayIso(),
    purchaseTime: nowTimeIso(),
    basketDiscount: 0,
    notes: '',
    sourceAccountId: null,
    paymentMode: 'single',
    voucherAccountId: null,
    voucherCount: 0,
    voucherUnitValue: 5.16,
    draftItems: [],
    savedReceiptId: null,
    activeMode: defaultEntryMode(),
  };

  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedDraft>;
    const resolvedAccountId = typeof parsed.fireflyAccountId === 'number' ? parsed.fireflyAccountId : null;
    return {
      fireflyAccountId: resolvedAccountId,
      storeName: typeof parsed.storeName === 'string' ? parsed.storeName : '',
      storeId: resolvedAccountId,
      purchaseDate: parsed.purchaseDate || todayIso(),
      purchaseTime: parsed.purchaseTime || nowTimeIso(),
      basketDiscount: typeof parsed.basketDiscount === 'number' ? parsed.basketDiscount : 0,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      sourceAccountId: parsed.sourceAccountId ?? null,
      paymentMode: parsed.paymentMode === 'split_vouchers' ? 'split_vouchers' : 'single',
      voucherAccountId: parsed.voucherAccountId ?? null,
      voucherCount: typeof parsed.voucherCount === 'number' ? parsed.voucherCount : 0,
      voucherUnitValue: typeof parsed.voucherUnitValue === 'number' ? parsed.voucherUnitValue : 5.16,
      draftItems: Array.isArray(parsed.draftItems) ? parsed.draftItems : [],
      savedReceiptId: typeof parsed.savedReceiptId === 'number' ? parsed.savedReceiptId : null,
      activeMode: parsed.activeMode === 'stream' || parsed.activeMode === 'grid'
        ? parsed.activeMode
        : defaultEntryMode(),
    };
  } catch {
    return fallback;
  }
};

export type DraftItemInput = Omit<DraftReceiptItem, 'temp_id' | 'line_total'>;

interface ReceiptWorkbenchContextValue {
  fireflyAccountId: number | null;
  setFireflyAccountId: (id: number | null) => void;
  storeName: string;
  setStoreName: (name: string) => void;
  purchaseDate: string;
  setPurchaseDate: (date: string) => void;
  purchaseTime: string;
  setPurchaseTime: (time: string) => void;
  basketDiscount: number;
  setBasketDiscount: (discount: number) => void;
  notes: string;
  setNotes: (notes: string) => void;
  sourceAccountId: number | null;
  setSourceAccountId: (id: number | null) => void;
  paymentMode: PaymentMode;
  setPaymentMode: (mode: PaymentMode) => void;
  voucherAccountId: number | null;
  setVoucherAccountId: (id: number | null) => void;
  voucherCount: number;
  setVoucherCount: (count: number) => void;
  voucherUnitValue: number;
  setVoucherUnitValue: (value: number) => void;
  draftItems: DraftReceiptItem[];
  savedReceiptId: number | null;
  setSavedReceiptId: (id: number | null) => void;
  activeMode: EntryMode;
  setActiveMode: (mode: EntryMode) => void;
  attachedFile: File | null;
  setAttachedFile: (file: File | null) => void;
  isHydrated: boolean;

  addItem: (item: DraftItemInput) => void;
  updateItem: (tempId: string, updates: Partial<DraftItemInput>) => void;
  removeItem: (tempId: string) => void;
  clearDraft: () => void;

  computedItemsSum: number;
  calculatedSum: number;
  canSaveLocally: boolean;
  canPushToFirefly: boolean;

  assetAccounts: FireflyAssetAccount[];
  assetAccountsError: string | null;
  refreshAssetAccounts: () => Promise<void>;
  mealVoucherAccounts: FireflyAssetAccount[];
  selectedSourceAccount: FireflyAssetAccount | undefined;
  selectedVoucherAccount: FireflyAssetAccount | undefined;
  usableVouchers: number | null;
  maxByTotal: number;
  maxVouchers: number;
  voucherCovered: number;
  cardRemainder: number;
  requiresSourceAccount: boolean;
  voucherLimitExceeded: boolean;
}

const ReceiptWorkbenchContext = createContext<ReceiptWorkbenchContextValue | undefined>(undefined);

export const ReceiptWorkbenchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(loadInitialDraft, []);

  const [fireflyAccountId, setFireflyAccountId] = useState<number | null>(initial.fireflyAccountId);
  const [storeName, setStoreName] = useState<string>(initial.storeName);
  const [purchaseDate, setPurchaseDate] = useState<string>(initial.purchaseDate);
  const [purchaseTime, setPurchaseTime] = useState<string>(initial.purchaseTime);
  const [basketDiscount, setBasketDiscount] = useState<number>(initial.basketDiscount);
  const [notes, setNotes] = useState<string>(initial.notes);
  const [sourceAccountId, setSourceAccountId] = useState<number | null>(initial.sourceAccountId);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initial.paymentMode);
  const [voucherAccountId, setVoucherAccountId] = useState<number | null>(initial.voucherAccountId);
  const [voucherCount, setVoucherCount] = useState<number>(initial.voucherCount);
  const [voucherUnitValue, setVoucherUnitValue] = useState<number>(initial.voucherUnitValue);
  const [draftItems, setDraftItems] = useState<DraftReceiptItem[]>(initial.draftItems);
  const [savedReceiptId, setSavedReceiptId] = useState<number | null>(initial.savedReceiptId);
  const [activeMode, setActiveMode] = useState<EntryMode>(initial.activeMode);
  const [attachedFile, setAttachedFileState] = useState<File | null>(null);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [assetAccounts, setAssetAccounts] = useState<FireflyAssetAccount[]>([]);
  const [assetAccountsError, setAssetAccountsError] = useState<string | null>(null);

  const refreshAssetAccounts = useCallback(async () => {
    try {
      const accounts = await api.firefly.getAssetAccounts();
      setAssetAccounts(accounts);
      setAssetAccountsError(null);
    } catch (err) {
      setAssetAccountsError(
        err instanceof Error
          ? err.message
          : 'Unable to fetch Firefly III asset accounts'
      );
    }
  }, []);

  useEffect(() => {
    refreshAssetAccounts();
  }, [refreshAssetAccounts]);

  // Hydrate binary attachment from IndexedDB before allowing writes/deletions
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedFile = await get<File | Blob>(FILE_STORAGE_KEY);
        if (!cancelled && storedFile) {
          const normalized =
            storedFile instanceof File
              ? storedFile
              : new File([storedFile], 'receipt-attachment', {
                  type: storedFile.type || 'application/octet-stream',
                });
          setAttachedFileState(normalized);
        }
      } catch (err) {
        console.error('Failed to hydrate attachment from IndexedDB:', err);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist structured draft to localStorage with 300ms debounce
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const payload: PersistedDraft = {
        fireflyAccountId,
        storeName,
        storeId: fireflyAccountId,
        purchaseDate,
        purchaseTime,
        basketDiscount,
        notes,
        sourceAccountId,
        paymentMode,
        voucherAccountId,
        voucherCount,
        voucherUnitValue,
        draftItems,
        savedReceiptId,
        activeMode,
      };
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.error('Failed to persist draft receipt:', err);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    fireflyAccountId,
    storeName,
    purchaseDate,
    purchaseTime,
    basketDiscount,
    notes,
    sourceAccountId,
    paymentMode,
    voucherAccountId,
    voucherCount,
    voucherUnitValue,
    draftItems,
    savedReceiptId,
    activeMode,
  ]);

  const setAttachedFile = useCallback(
    (file: File | null) => {
      setAttachedFileState(file);
      if (!isHydrated) return;
      if (file) {
        set(FILE_STORAGE_KEY, file).catch(err =>
          console.error('Failed to save draft attachment to IndexedDB:', err)
        );
      } else {
        del(FILE_STORAGE_KEY).catch(err =>
          console.error('Failed to delete draft attachment from IndexedDB:', err)
        );
      }
    },
    [isHydrated]
  );

  const addItem = useCallback((item: DraftItemInput) => {
    const lineTotal =
      item.total_price !== undefined
        ? round2(item.total_price)
        : round2(item.quantity * item.paid_price);
    const newItem: DraftReceiptItem = {
      ...item,
      temp_id: createTempId(),
      line_total: lineTotal,
    };
    setDraftItems(prev => [...prev, newItem]);
  }, []);

  const updateItem = useCallback((tempId: string, updates: Partial<DraftItemInput>) => {
    setDraftItems(prev =>
      prev.map(existing => {
        if (existing.temp_id !== tempId) return existing;
        const merged = { ...existing, ...updates };
        if ('quantity' in updates && !('total_price' in updates) && updates.total_price === undefined) {
          merged.total_price = undefined;
        }
        const lineTotal =
          merged.total_price !== undefined
            ? round2(merged.total_price)
            : round2(merged.quantity * merged.paid_price);
        return {
          ...merged,
          line_total: lineTotal,
        };
      })
    );
  }, []);

  const removeItem = useCallback((tempId: string) => {
    setDraftItems(prev => prev.filter(item => item.temp_id !== tempId));
  }, []);

  const clearDraft = useCallback(() => {
    setFireflyAccountId(null);
    setStoreName('');
    setPurchaseDate(todayIso());
    setPurchaseTime(nowTimeIso());
    setBasketDiscount(0);
    setNotes('');
    setSourceAccountId(null);
    setPaymentMode('single');
    setVoucherAccountId(null);
    setVoucherCount(0);
    setVoucherUnitValue(5.16);
    setDraftItems([]);
    setSavedReceiptId(null);
    setAttachedFileState(null);
    try {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore storage quota errors
    }
    del(FILE_STORAGE_KEY).catch(() => undefined);
  }, []);

  const computedItemsSum = useMemo(
    () => round2(draftItems.reduce((sum, item) => sum + item.line_total, 0)),
    [draftItems]
  );

  const calculatedSum = useMemo(
    () => round2(computedItemsSum - basketDiscount),
    [computedItemsSum, basketDiscount]
  );

  const mealVoucherAccounts = useMemo(
    () => assetAccounts.filter(a => a.asset_type === 'meal_voucher'),
    [assetAccounts]
  );

  const selectedSourceAccount = useMemo(
    () => assetAccounts.find(a => a.id === sourceAccountId),
    [assetAccounts, sourceAccountId]
  );

  const selectedVoucherAccount = useMemo(
    () => assetAccounts.find(a => a.id === voucherAccountId),
    [assetAccounts, voucherAccountId]
  );

  const isSelectedVoucherFlagged =
    selectedVoucherAccount?.asset_type === 'meal_voucher' &&
    Boolean(
      selectedVoucherAccount.voucher_unit_value &&
        selectedVoucherAccount.voucher_unit_value > 0
    );

  const totalCents = Math.round(Math.max(calculatedSum, 0) * 100);
  const activeUnitValue =
    isSelectedVoucherFlagged && selectedVoucherAccount?.voucher_unit_value
      ? selectedVoucherAccount.voucher_unit_value
      : voucherUnitValue;
  const unitCents = Math.round(Math.max(activeUnitValue, 0) * 100);

  const maxByTotal = unitCents > 0 ? Math.floor(totalCents / unitCents) : 0;
  const usableVouchers = isSelectedVoucherFlagged
    ? selectedVoucherAccount?.usable_vouchers ?? 0
    : null;
  const maxVouchers =
    usableVouchers !== null ? Math.min(usableVouchers, maxByTotal) : maxByTotal;

  const voucherCents =
    paymentMode === 'split_vouchers' ? Math.max(0, voucherCount) * unitCents : 0;
  const voucherCovered = Math.round(voucherCents) / 100;
  const cardRemainderCents =
    paymentMode === 'split_vouchers'
      ? Math.max(0, totalCents - voucherCents)
      : totalCents;
  const cardRemainder = Math.round(cardRemainderCents) / 100;

  const requiresSourceAccount =
    paymentMode !== 'split_vouchers' || cardRemainderCents > 0;
  const voucherLimitExceeded =
    paymentMode === 'split_vouchers' && voucherCount > maxVouchers;

  const canSaveLocally =
    Boolean(fireflyAccountId) &&
    Boolean(purchaseTime.trim()) &&
    draftItems.length > 0 &&
    calculatedSum > 0 &&
    (paymentMode !== 'split_vouchers' || voucherCount <= maxByTotal) &&
    draftItems.every(
      i => i.product_id > 0 && i.quantity > 0 && i.package_size > 0 && i.paid_price >= 0
    );

  const canPushToFirefly =
    canSaveLocally &&
    (!requiresSourceAccount || Boolean(sourceAccountId)) &&
    (paymentMode !== 'split_vouchers' ||
      (Boolean(voucherAccountId) && voucherCount > 0 && !voucherLimitExceeded));

  const value: ReceiptWorkbenchContextValue = {
    fireflyAccountId,
    setFireflyAccountId,
    storeName,
    setStoreName,
    purchaseDate,
    setPurchaseDate,
    purchaseTime,
    setPurchaseTime,
    basketDiscount,
    setBasketDiscount,
    notes,
    setNotes,
    sourceAccountId,
    setSourceAccountId,
    paymentMode,
    setPaymentMode,
    voucherAccountId,
    setVoucherAccountId,
    voucherCount,
    setVoucherCount,
    voucherUnitValue,
    setVoucherUnitValue,
    draftItems,
    savedReceiptId,
    setSavedReceiptId,
    activeMode,
    setActiveMode,
    attachedFile,
    setAttachedFile,
    isHydrated,
    addItem,
    updateItem,
    removeItem,
    clearDraft,
    computedItemsSum,
    calculatedSum,
    canSaveLocally,
    canPushToFirefly,
    assetAccounts,
    assetAccountsError,
    refreshAssetAccounts,
    mealVoucherAccounts,
    selectedSourceAccount,
    selectedVoucherAccount,
    usableVouchers,
    maxByTotal,
    maxVouchers,
    voucherCovered,
    cardRemainder,
    requiresSourceAccount,
    voucherLimitExceeded,
  };

  return (
    <ReceiptWorkbenchContext.Provider value={value}>
      {children}
    </ReceiptWorkbenchContext.Provider>
  );
};

export function useReceiptWorkbench(): ReceiptWorkbenchContextValue {
  const ctx = useContext(ReceiptWorkbenchContext);
  if (!ctx) {
    throw new Error('useReceiptWorkbench must be used inside a ReceiptWorkbenchProvider');
  }
  return ctx;
}
