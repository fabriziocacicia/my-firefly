import React, { useRef, useState } from 'react';
import { Check, Pencil, Plus, ReceiptText, Trash2, X } from 'lucide-react';
import { DraftItemInput, useReceiptWorkbench } from '../../context/ReceiptWorkbenchContext';
import { DraftReceiptItem, MeasureUnit, Product, SaleMode } from '../../types';
import { ItemEditorModal } from '../catalog/ItemEditorModal';
import { ProductCombobox } from './ProductCombobox';
import {
  PriceInputMode,
  computePriceFromInput,
  formatPackagingLabel,
  toMeasureUnit,
} from './productUtils';

export const CardStreamView: React.FC = () => {
  const { draftItems, addItem, updateItem, removeItem } = useReceiptWorkbench();

  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [brandName, setBrandName] = useState<string | undefined>(undefined);
  const [saleMode, setSaleMode] = useState<SaleMode>('packaged');
  const [packCount, setPackCount] = useState(1);
  const [unitSize, setUnitSize] = useState(1);
  const [unit, setUnit] = useState<MeasureUnit>('pcs');
  const [pkgSize, setPkgSize] = useState(1);
  const [categoryName, setCategoryName] = useState<string | null | undefined>(undefined);
  const [effectiveTagNames, setEffectiveTagNames] = useState<string[]>([]);

  const [qty, setQty] = useState('1');
  const [priceMode, setPriceMode] = useState<PriceInputMode>('unit');
  const [priceValue, setPriceValue] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [isDiscount, setIsDiscount] = useState(false);

  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialName, setModalInitialName] = useState('');
  const [lastCreatedProduct, setLastCreatedProduct] = useState<Product | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const resetActiveCard = () => {
    setEditingTempId(null);
    setSelectedProductId(null);
    setProductName('');
    setBrandName(undefined);
    setSaleMode('packaged');
    setPackCount(1);
    setUnitSize(1);
    setUnit('pcs');
    setPkgSize(1);
    setCategoryName(undefined);
    setEffectiveTagNames([]);
    setQty('1');
    setPriceMode('unit');
    setPriceValue('');
    setRegularPrice('');
    setIsDiscount(false);
    setFormError(null);
  };

  const applyProductSelection = (prod: Product) => {
    setSelectedProductId(prod.id);
    setProductName(prod.name);
    setBrandName(prod.brand?.name);
    setSaleMode(prod.sale_mode || 'packaged');
    setPackCount(prod.pack_count || 1);
    setUnitSize(prod.unit_size || prod.package_size || 1);
    setUnit(toMeasureUnit(prod.default_unit));
    setPkgSize(prod.package_size > 0 ? prod.package_size : 1);
    setCategoryName(prod.firefly_category_name);
    const eff = prod.effective_tags && prod.effective_tags.length > 0 ? prod.effective_tags : prod.tags;
    setEffectiveTagNames(eff.map(t => t.name));
    setQty('1');
    setFormError(null);
    window.setTimeout(() => qtyInputRef.current?.focus(), 0);
  };

  const loadItemForEdit = (item: DraftReceiptItem) => {
    setEditingTempId(item.temp_id);
    setSelectedProductId(item.product_id);
    setProductName(item.product_name);
    setBrandName(item.brand_name);
    setSaleMode(item.sale_mode || 'packaged');
    setPackCount(item.pack_count || 1);
    setUnitSize(item.unit_size || item.package_size || 1);
    setUnit(item.unit);
    setPkgSize(item.package_size);
    setCategoryName(item.firefly_category_name);
    setEffectiveTagNames(item.effective_tag_names || []);
    setQty(String(item.quantity));
    if (item.total_price !== undefined) {
      setPriceMode('total');
      setPriceValue(String(item.total_price));
    } else {
      setPriceMode('unit');
      setPriceValue(String(item.paid_price));
    }
    setRegularPrice(item.regular_price !== undefined ? String(item.regular_price) : '');
    setIsDiscount(item.is_discount);
    setFormError(null);
  };

  const handleSubmitCard = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProductId || !productName) {
      setFormError('Select or create an item before adding.');
      productInputRef.current?.focus();
      return;
    }
    const parsedQty = parseFloat(qty);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      setFormError('Quantity / weight must be greater than zero.');
      return;
    }
    if (saleMode !== 'loose_weight' && !Number.isInteger(parsedQty)) {
      setFormError('Packaged items require a whole pack quantity (1, 2, ...).');
      return;
    }

    const computed = computePriceFromInput(priceMode, priceValue, parsedQty);
    if (!computed) {
      setFormError('Enter a valid price.');
      return;
    }

    const parsedReg = regularPrice.trim() !== '' ? parseFloat(regularPrice) : undefined;
    if (parsedReg !== undefined && (isNaN(parsedReg) || parsedReg < 0)) {
      setFormError('Regular price must be >= 0.');
      return;
    }

    const payload: DraftItemInput = {
      product_id: selectedProductId,
      product_name: productName,
      brand_name: brandName,
      sale_mode: saleMode,
      pack_count: packCount,
      unit_size: unitSize,
      firefly_category_name: categoryName,
      effective_tag_names: effectiveTagNames,
      quantity: parsedQty,
      unit,
      package_size: pkgSize,
      paid_price: computed.paidPrice,
      total_price: computed.totalPrice,
      regular_price: parsedReg,
      is_discount:
        isDiscount || (parsedReg !== undefined && computed.paidPrice < parsedReg),
    };

    if (editingTempId) {
      updateItem(editingTempId, payload);
    } else {
      addItem(payload);
    }

    resetActiveCard();
    window.setTimeout(() => productInputRef.current?.focus(), 0);
  };

  const handlePriceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !comboboxOpen) {
      e.preventDefault();
      handleSubmitCard();
    }
  };

  const parsedQty = parseFloat(qty) || 0;
  const computedPreview = computePriceFromInput(priceMode, priceValue, parsedQty);
  const previewLineTotal = computedPreview ? computedPreview.lineTotal : 0;

  // Prepend newest items at the top of the Register Tape while preserving original #
  const reversedTape = [...draftItems]
    .map((item, idx) => ({ item, lineNumber: idx + 1 }))
    .reverse();

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 max-w-6xl mx-auto gap-6 items-start">
      {/* Left Pane (Desktop) / Sticky Top (Mobile): Active Focus Card */}
      <form
        onSubmit={handleSubmitCard}
        className="md:col-span-5 sticky top-16 md:top-20 z-20 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h2 className="text-sm font-bold text-slate-900">
            {editingTempId ? 'Edit Receipt Line' : 'Add Receipt Line'}
          </h2>
          <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
            Line: €{previewLineTotal.toFixed(2)}
          </span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Item *
          </label>
          <ProductCombobox
            selectedProductName={productName}
            onSelect={applyProductSelection}
            onClearSelection={() => {
              setSelectedProductId(null);
              setBrandName(undefined);
              setCategoryName(undefined);
              setEffectiveTagNames([]);
            }}
            onRequestCreate={initialName => {
              setModalInitialName(initialName);
              setModalOpen(true);
            }}
            inputRef={productInputRef}
            placeholder="Search or create item..."
            inputClassName="min-h-[44px]"
            onDropdownOpenChange={setComboboxOpen}
            extraCreatedProduct={lastCreatedProduct}
          />
          {selectedProductId && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium">
                {formatPackagingLabel(saleMode, packCount, unitSize, pkgSize, unit)}
              </span>
              {categoryName && (
                <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium">
                  {categoryName}
                </span>
              )}
              {effectiveTagNames.map(tName => (
                <span key={tName} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                  #{tName}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {saleMode === 'loose_weight' ? `Weight (${unit})` : 'Quantity (packs)'}
            </label>
            <input
              ref={qtyInputRef}
              type="number"
              step={saleMode === 'loose_weight' ? 'any' : '1'}
              min={saleMode === 'loose_weight' ? '0.001' : '1'}
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                {priceMode === 'unit' ? 'Unit Price (€) *' : 'Total Price (€) *'}
              </label>
              <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 overflow-hidden text-[10px] font-semibold">
                <button
                  type="button"
                  onClick={() => setPriceMode('unit')}
                  className={`px-1.5 py-0.5 ${
                    priceMode === 'unit' ? 'bg-blue-600 text-white' : 'text-slate-600'
                  }`}
                >
                  Unit
                </button>
                <button
                  type="button"
                  onClick={() => setPriceMode('total')}
                  className={`px-1.5 py-0.5 ${
                    priceMode === 'total' ? 'bg-blue-600 text-white' : 'text-slate-600'
                  }`}
                >
                  Total
                </button>
              </div>
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={priceValue}
              onChange={e => setPriceValue(e.target.value)}
              onKeyDown={handlePriceKeyDown}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Regular Shelf Unit Price (€)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Same as paid"
            value={regularPrice}
            onChange={e => setRegularPrice(e.target.value)}
            onKeyDown={handlePriceKeyDown}
            className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>

        <label className="flex items-center space-x-2.5 min-h-[44px] px-3 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={isDiscount}
            onChange={e => setIsDiscount(e.target.checked)}
            className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
          />
          <span className="text-xs font-semibold text-slate-700">
            Discounted / Sale Item
          </span>
        </label>

        {formError && (
          <p className="text-xs text-rose-600 font-medium">{formError}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {editingTempId && (
            <button
              type="button"
              onClick={resetActiveCard}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 inline-flex items-center justify-center"
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm inline-flex items-center justify-center"
          >
            {editingTempId ? (
              <>
                <Check className="w-4 h-4 mr-1.5" /> Update Line
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1.5" /> Add Line
              </>
            )}
          </button>
        </div>
      </form>

      {/* Right Pane (Desktop) / Below (Mobile): Register Tape */}
      <div className="md:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <ReceiptText className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">
              Register Tape ({draftItems.length} {draftItems.length === 1 ? 'item' : 'items'})
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">Newest on top • Click to edit</span>
        </div>

        {reversedTape.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            No items logged yet. Search an item on the active card and press{' '}
            <strong>Add Line</strong> or <strong>Enter</strong>.
          </div>
        ) : (
          <div className="mt-3 space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {reversedTape.map(({ item, lineNumber }) => {
              const isEditing = editingTempId === item.temp_id;
              return (
                <div
                  key={item.temp_id}
                  onClick={() => loadItemForEdit(item)}
                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                    isEditing
                      ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-300'
                      : 'bg-slate-50 border-slate-200/80 hover:border-blue-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-start space-x-3 min-w-0">
                    <span className="text-xs font-mono font-bold text-slate-400 mt-0.5 shrink-0">
                      #{lineNumber}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-slate-900 truncate">
                          {item.product_name}
                        </span>
                        {item.is_discount && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                            SALE
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {item.quantity} × €{item.paid_price.toFixed(2)} •{' '}
                        {formatPackagingLabel(
                          item.sale_mode,
                          item.pack_count,
                          item.unit_size,
                          item.package_size,
                          item.unit
                        )}
                        {item.firefly_category_name ? ` • ${item.firefly_category_name}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <strong className="text-sm text-slate-900">
                      €{item.line_total.toFixed(2)}
                    </strong>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        loadItemForEdit(item);
                      }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                      title="Edit item"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        if (editingTempId === item.temp_id) {
                          resetActiveCard();
                        }
                        removeItem(item.temp_id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                      title="Delete item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ItemEditorModal
        isOpen={modalOpen}
        initialName={modalInitialName}
        onClose={() => setModalOpen(false)}
        onSaved={created => {
          setLastCreatedProduct(created);
          applyProductSelection(created);
        }}
      />
    </div>
  );
};
