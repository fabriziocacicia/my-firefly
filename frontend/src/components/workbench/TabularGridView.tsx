import React, { useEffect, useRef, useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { DraftItemInput, useReceiptWorkbench } from '../../context/ReceiptWorkbenchContext';
import { DraftReceiptItem, MeasureUnit, Product } from '../../types';
import { ItemEditorModal } from '../catalog/ItemEditorModal';
import { ProductCombobox } from './ProductCombobox';
import {
  PriceInputMode,
  computePriceFromInput,
  formatPackagingLabel,
  toMeasureUnit,
} from './productUtils';

interface CommittedNumberInputProps {
  value: number | undefined;
  onCommit: (next: number | undefined) => void;
  allowEmpty?: boolean;
  integerOnly?: boolean;
  min?: number;
  step?: string;
  placeholder?: string;
  className?: string;
  title?: string;
}

const CommittedNumberInput: React.FC<CommittedNumberInputProps> = ({
  value,
  onCommit,
  allowEmpty = false,
  integerOnly = false,
  min = 0,
  step = '0.01',
  placeholder,
  className,
  title,
}) => {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value !== undefined ? String(value) : '');
    }
  }, [value, focused]);

  return (
    <input
      type="number"
      step={step}
      min={min}
      placeholder={placeholder}
      title={title}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={e => {
        const raw = e.target.value;
        setDraft(raw);
        if (raw.trim() === '') {
          if (allowEmpty) onCommit(undefined);
          return;
        }
        const parsed = parseFloat(raw);
        if (isNaN(parsed) || parsed < min) return;
        if (integerOnly && !Number.isInteger(parsed)) return;
        onCommit(parsed);
      }}
      onBlur={() => {
        setFocused(false);
        if (draft.trim() === '') {
          if (allowEmpty) {
            onCommit(undefined);
          } else {
            setDraft(value !== undefined ? String(value) : '');
          }
          return;
        }
        const parsed = parseFloat(draft);
        if (
          isNaN(parsed) ||
          parsed < min ||
          (integerOnly && !Number.isInteger(parsed))
        ) {
          setDraft(value !== undefined ? String(value) : '');
        }
      }}
      className={className}
    />
  );
};

export const TabularGridView: React.FC = () => {
  const { draftItems, addItem, updateItem, removeItem } = useReceiptWorkbench();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productLabel, setProductLabel] = useState('');
  const [qty, setQty] = useState('1');
  const [priceMode, setPriceMode] = useState<PriceInputMode>('unit');
  const [priceValue, setPriceValue] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [isDiscount, setIsDiscount] = useState(false);

  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialName, setModalInitialName] = useState('');
  const [lastCreatedProduct, setLastCreatedProduct] = useState<Product | null>(null);
  const [activeRowError, setActiveRowError] = useState<string | null>(null);

  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const resetActiveRow = () => {
    setSelectedProduct(null);
    setProductLabel('');
    setQty('1');
    setPriceMode('unit');
    setPriceValue('');
    setRegularPrice('');
    setIsDiscount(false);
    setActiveRowError(null);
  };

  const applyProductToActiveRow = (prod: Product) => {
    setSelectedProduct(prod);
    setProductLabel(prod.name);
    setQty('1');
    setActiveRowError(null);
    window.setTimeout(() => qtyInputRef.current?.focus(), 0);
  };

  const commitActiveRow = () => {
    if (!selectedProduct) {
      setActiveRowError('Select an item first.');
      productInputRef.current?.focus();
      return;
    }
    const parsedQty = parseFloat(qty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setActiveRowError('Quantity / weight must be > 0.');
      return;
    }
    if (selectedProduct.sale_mode !== 'loose_weight' && !Number.isInteger(parsedQty)) {
      setActiveRowError('Packaged items require a whole pack quantity (1, 2, ...).');
      return;
    }

    const computed = computePriceFromInput(priceMode, priceValue, parsedQty);
    if (!computed) {
      setActiveRowError('Enter a valid price.');
      return;
    }

    const parsedReg = regularPrice.trim() !== '' ? parseFloat(regularPrice) : undefined;
    if (parsedReg !== undefined && (isNaN(parsedReg) || parsedReg < 0)) {
      setActiveRowError('Regular price must be >= 0.');
      return;
    }

    const effectiveTags =
      selectedProduct.effective_tags && selectedProduct.effective_tags.length > 0
        ? selectedProduct.effective_tags
        : selectedProduct.tags;

    const input: DraftItemInput = {
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      brand_name: selectedProduct.brand?.name,
      sale_mode: selectedProduct.sale_mode || 'packaged',
      pack_count: selectedProduct.pack_count || 1,
      unit_size: selectedProduct.unit_size || selectedProduct.package_size || 1,
      firefly_category_name: selectedProduct.firefly_category_name,
      effective_tag_names: effectiveTags.map(t => t.name),
      quantity: parsedQty,
      unit: toMeasureUnit(selectedProduct.default_unit),
      package_size: selectedProduct.package_size > 0 ? selectedProduct.package_size : 1,
      paid_price: computed.paidPrice,
      total_price: computed.totalPrice,
      regular_price: parsedReg,
      is_discount:
        isDiscount || (parsedReg !== undefined && computed.paidPrice < parsedReg),
    };
    addItem(input);
    resetActiveRow();
    window.setTimeout(() => productInputRef.current?.focus(), 0);
  };

  const handlePriceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !comboboxOpen) {
      e.preventDefault();
      commitActiveRow();
    }
  };

  const parsedActiveQty = parseFloat(qty) || 0;
  const activeComputed = computePriceFromInput(priceMode, priceValue, parsedActiveQty);
  const activeLineTotal = activeComputed ? activeComputed.lineTotal : 0;

  const updateExistingNumber = (
    item: DraftReceiptItem,
    field: 'quantity' | 'paid_price' | 'regular_price',
    raw: string
  ) => {
    if (field === 'regular_price' && raw.trim() === '') {
      updateItem(item.temp_id, { regular_price: undefined });
      return;
    }
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    if (field === 'quantity') {
      if (parsed <= 0) return;
      if (item.sale_mode !== 'loose_weight' && !Number.isInteger(parsed)) return;
    }
    if ((field === 'paid_price' || field === 'regular_price') && parsed < 0) return;
    updateItem(item.temp_id, { [field]: parsed });
  };

  const activeIsLoose = selectedProduct?.sale_mode === 'loose_weight';

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[11px]">
            <tr>
              <th className="px-3 py-3 text-left font-semibold w-10">#</th>
              <th className="px-3 py-3 text-left font-semibold min-w-[260px]">Item</th>
              <th className="px-2 py-3 text-left font-semibold w-28">Qty / Weight</th>
              <th className="px-2 py-3 text-left font-semibold w-44">Price (€)</th>
              <th className="px-2 py-3 text-left font-semibold w-28">Regular (€)</th>
              <th className="px-2 py-3 text-center font-semibold w-20">Sale</th>
              <th className="px-3 py-3 text-right font-semibold w-24">Line Total</th>
              <th className="px-3 py-3 text-right font-semibold w-20">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {draftItems.map((item, idx) => (
              <tr
                key={item.temp_id}
                tabIndex={-1}
                onKeyDown={e => {
                  const targetTag = (e.target as HTMLElement).tagName;
                  if (
                    (e.key === 'Delete' || e.key === 'Backspace') &&
                    targetTag !== 'INPUT' &&
                    targetTag !== 'SELECT'
                  ) {
                    e.preventDefault();
                    removeItem(item.temp_id);
                  }
                }}
                className="hover:bg-slate-50/80 transition"
              >
                <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-slate-900">{item.product_name}</div>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5 text-[10px] text-slate-500">
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded font-medium">
                      {formatPackagingLabel(
                        item.sale_mode,
                        item.pack_count,
                        item.unit_size,
                        item.package_size,
                        item.unit
                      )}
                    </span>
                    {item.firefly_category_name && (
                      <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                        {item.firefly_category_name}
                      </span>
                    )}
                    {item.effective_tag_names?.map(tName => (
                      <span
                        key={tName}
                        className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded"
                      >
                        #{tName}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center space-x-1">
                    <CommittedNumberInput
                      step={item.sale_mode === 'loose_weight' ? 'any' : '1'}
                      min={item.sale_mode === 'loose_weight' ? 0.001 : 1}
                      integerOnly={item.sale_mode !== 'loose_weight'}
                      value={item.quantity}
                      onCommit={next => {
                        if (next !== undefined) updateExistingNumber(item, 'quantity', String(next));
                      }}
                      className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs"
                    />
                    {item.sale_mode === 'loose_weight' && (
                      <span className="text-[11px] text-slate-500 font-medium">
                        {item.unit}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <CommittedNumberInput
                    step="0.01"
                    min={0}
                    value={item.paid_price}
                    onCommit={next => {
                      if (next !== undefined) updateExistingNumber(item, 'paid_price', String(next));
                    }}
                    className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs font-semibold"
                    title="Unit price (€)"
                  />
                </td>
                <td className="px-2 py-2">
                  <CommittedNumberInput
                    step="0.01"
                    min={0}
                    allowEmpty
                    placeholder="Same"
                    value={item.regular_price}
                    onCommit={next =>
                      updateExistingNumber(item, 'regular_price', next !== undefined ? String(next) : '')
                    }
                    className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs"
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={item.is_discount}
                    onChange={e =>
                      updateItem(item.temp_id, { is_discount: e.target.checked })
                    }
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                </td>
                <td className="px-3 py-2 text-right font-bold text-slate-900">
                  €{item.line_total.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeItem(item.temp_id)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50"
                    title="Delete row"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}

            {/* Uncommitted Active Entry Row */}
            <tr
              className="bg-blue-50/40"
              onKeyDown={e => {
                if (
                  (e.key === 'Delete' || e.key === 'Backspace') &&
                  !selectedProduct &&
                  priceValue === '' &&
                  productLabel === '' &&
                  (e.target as HTMLElement).tagName !== 'INPUT'
                ) {
                  e.preventDefault();
                  resetActiveRow();
                }
              }}
            >
              <td className="px-3 py-2.5 text-blue-600 font-bold">+</td>
              <td className="px-3 py-2.5">
                <ProductCombobox
                  selectedProductName={productLabel}
                  onSelect={applyProductToActiveRow}
                  onClearSelection={() => {
                    setSelectedProduct(null);
                  }}
                  onRequestCreate={initialName => {
                    setModalInitialName(initialName);
                    setModalOpen(true);
                  }}
                  inputRef={productInputRef}
                  placeholder="Type item name..."
                  onDropdownOpenChange={setComboboxOpen}
                  extraCreatedProduct={lastCreatedProduct}
                />
                {selectedProduct && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                    <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-medium">
                      {formatPackagingLabel(
                        selectedProduct.sale_mode,
                        selectedProduct.pack_count,
                        selectedProduct.unit_size,
                        selectedProduct.package_size,
                        selectedProduct.default_unit as MeasureUnit
                      )}
                    </span>
                    {selectedProduct.firefly_category_name && (
                      <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                        {selectedProduct.firefly_category_name}
                      </span>
                    )}
                    {(selectedProduct.effective_tags || selectedProduct.tags).map(t => (
                      <span
                        key={t.id}
                        className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded"
                      >
                        #{t.name}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-2 py-2.5">
                <div className="flex items-center space-x-1">
                  <input
                    ref={qtyInputRef}
                    type="number"
                    step={activeIsLoose ? 'any' : '1'}
                    min={activeIsLoose ? '0.001' : '1'}
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs bg-white"
                  />
                  {activeIsLoose && (
                    <span className="text-[11px] font-semibold text-slate-600">
                      {selectedProduct?.default_unit}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2.5">
                <div className="flex items-center space-x-1">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={priceValue}
                    onChange={e => setPriceValue(e.target.value)}
                    onKeyDown={handlePriceKeyDown}
                    className="w-full min-w-0 px-2 py-1.5 border border-slate-300 rounded-md text-xs font-semibold bg-white"
                  />
                  <div className="inline-flex rounded-md border border-slate-300 bg-white overflow-hidden shrink-0 text-[10px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setPriceMode('unit')}
                      className={`px-1.5 py-1 ${
                        priceMode === 'unit'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                      title="Enter unit price"
                    >
                      Unit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPriceMode('total')}
                      className={`px-1.5 py-1 ${
                        priceMode === 'total'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                      title="Enter total line price"
                    >
                      Tot
                    </button>
                  </div>
                </div>
              </td>
              <td className="px-2 py-2.5">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Same"
                  value={regularPrice}
                  onChange={e => setRegularPrice(e.target.value)}
                  onKeyDown={handlePriceKeyDown}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs bg-white"
                />
              </td>
              <td className="px-2 py-2.5 text-center">
                <button
                  type="button"
                  onClick={() => setIsDiscount(v => !v)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold border transition inline-flex items-center ${
                    isDiscount
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : 'bg-white text-slate-500 border-slate-300'
                  }`}
                >
                  <Tag className="w-3 h-3 mr-1" />
                  {isDiscount ? 'Sale' : 'Reg'}
                </button>
              </td>
              <td className="px-3 py-2.5 text-right font-bold text-slate-700">
                €{activeLineTotal.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={commitActiveRow}
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {activeRowError && (
        <p className="text-xs text-rose-600 font-medium px-1">{activeRowError}</p>
      )}
      <p className="text-[11px] text-slate-400 px-1">
        Keyboard tips: <kbd className="px-1 py-0.5 bg-slate-100 rounded border">Tab</kbd> across
        cells, toggle <kbd className="px-1 py-0.5 bg-slate-100 rounded border">Unit / Tot</kbd> as
        needed, press <kbd className="px-1 py-0.5 bg-slate-100 rounded border">Enter</kbd> in Price
        to commit the row.
      </p>

      <ItemEditorModal
        isOpen={modalOpen}
        initialName={modalInitialName}
        onClose={() => setModalOpen(false)}
        onSaved={created => {
          setLastCreatedProduct(created);
          applyProductToActiveRow(created);
        }}
      />
    </div>
  );
};
