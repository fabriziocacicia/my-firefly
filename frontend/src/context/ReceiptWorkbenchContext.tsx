import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { del, get, set } from 'idb-keyval';
import { DraftReceiptItem, EntryMode, PaymentMode } from '../types';

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
  targetTotal: number;
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
    targetTotal: 0,
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
      targetTotal: typeof parsed.targetTotal === 'number' ? parsed.targetTotal : 0,
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
  targetTotal: number;
  setTargetTotal: (total: number) => void;
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
  discrepancyDelta: number;
  isBalanced: boolean;
  canSaveLocally: boolean;
  canPushToFirefly: boolean;
}

const ReceiptWorkbenchContext = createContext<ReceiptWorkbenchContextValue | undefined>(undefined);

export const ReceiptWorkbenchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = useMemo(loadInitialDraft, []);

  const [fireflyAccountId, setFireflyAccountId] = useState<number | null>(initial.fireflyAccountId);
  const [storeName, setStoreName] = useState<string>(initial.storeName);
  const [purchaseDate, setPurchaseDate] = useState<string>(initial.purchaseDate);
  const [purchaseTime, setPurchaseTime] = useState<string>(initial.purchaseTime);
  const [targetTotal, setTargetTotal] = useState<number>(initial.targetTotal);
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
        targetTotal,
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
    targetTotal,
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
    const newItem: DraftReceiptItem = {
      ...item,
      temp_id: createTempId(),
      line_total: round2(item.quantity * item.paid_price),
    };
    setDraftItems(prev => [...prev, newItem]);
  }, []);

  const updateItem = useCallback((tempId: string, updates: Partial<DraftItemInput>) => {
    setDraftItems(prev =>
      prev.map(existing => {
        if (existing.temp_id !== tempId) return existing;
        const merged = { ...existing, ...updates };
        return {
          ...merged,
          line_total: round2(merged.quantity * merged.paid_price),
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
    setTargetTotal(0);
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

  const discrepancyDelta = useMemo(
    () => round2(calculatedSum - targetTotal),
    [calculatedSum, targetTotal]
  );

  const isBalanced =
    targetTotal > 0 && draftItems.length > 0 && Math.abs(discrepancyDelta) <= 0.01;

  const canSaveLocally =
    Boolean(fireflyAccountId) &&
    Boolean(purchaseTime.trim()) &&
    isBalanced &&
    draftItems.every(
      i => i.product_id > 0 && i.quantity > 0 && i.package_size > 0 && i.paid_price >= 0
    );

  const totalCents = Math.round(Math.max(targetTotal, 0) * 100);
  const unitCents = Math.round(Math.max(voucherUnitValue, 0) * 100);
  const voucherCents =
    paymentMode === 'split_vouchers' ? Math.max(0, voucherCount) * unitCents : 0;
  const vouchersExceedTotal =
    paymentMode === 'split_vouchers' && voucherCents > totalCents;
  const cardRemainderCents =
    paymentMode === 'split_vouchers'
      ? Math.max(0, totalCents - voucherCents)
      : totalCents;
  const requiresSourceAccount =
    paymentMode !== 'split_vouchers' || cardRemainderCents > 0;

  const canPushToFirefly =
    canSaveLocally &&
    (!requiresSourceAccount || Boolean(sourceAccountId)) &&
    (paymentMode !== 'split_vouchers' ||
      (Boolean(voucherAccountId) && voucherCount > 0 && !vouchersExceedTotal));

  const value: ReceiptWorkbenchContextValue = {
    fireflyAccountId,
    setFireflyAccountId,
    storeName,
    setStoreName,
    purchaseDate,
    setPurchaseDate,
    purchaseTime,
    setPurchaseTime,
    targetTotal,
    setTargetTotal,
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
    discrepancyDelta,
    isBalanced,
    canSaveLocally,
    canPushToFirefly,
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
