import React, { useRef, useState } from 'react';
import { Check, Pencil, Plus, ReceiptText, Trash2, X } from 'lucide-react';
import { DraftItemInput, useReceiptWorkbench } from '../../context/ReceiptWorkbenchContext';
import { DraftReceiptItem, MeasureUnit, Product } from '../../types';
import { InlineProductModal } from './InlineProductModal';
import { MEASURE_UNITS, ProductCombobox, toMeasureUnit } from './ProductCombobox';

export const CardStreamView: React.FC = () => {
  const { draftItems, addItem, updateItem, removeItem } = useReceiptWorkbench();

  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState('');
  const [brandName, setBrandName] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<MeasureUnit>('pcs');
  const [pkgSize, setPkgSize] = useState('1');
  const [paidPrice, setPaidPrice] = useState('');
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
    setQty('1');
    setUnit('pcs');
    setPkgSize('1');
    setPaidPrice('');
    setRegularPrice('');
    setIsDiscount(false);
    setFormError(null);
  };

  const applyProductSelection = (prod: Product) => {
    setSelectedProductId(prod.id);
    setProductName(prod.name);
    setBrandName(prod.brand?.name);
    setUnit(toMeasureUnit(prod.default_unit));
    setPkgSize(String(prod.package_size > 0 ? prod.package_size : 1));
    setQty('1');
    setFormError(null);
    window.setTimeout(() => qtyInputRef.current?.focus(), 0);
  };

  const loadItemForEdit = (item: DraftReceiptItem) => {
    setEditingTempId(item.temp_id);
    setSelectedProductId(item.product_id);
    setProductName(item.product_name);
    setBrandName(item.brand_name);
    setQty(String(item.quantity));
    setUnit(item.unit);
    setPkgSize(String(item.package_size));
    setPaidPrice(String(item.paid_price));
    setRegularPrice(item.regular_price !== undefined ? String(item.regular_price) : '');
    setIsDiscount(item.is_discount);
    setFormError(null);
  };

  const handleSubmitCard = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedProductId || !productName) {
      setFormError('Select or create a product before adding.');
      productInputRef.current?.focus();
      return;
    }
    const parsedQty = parseFloat(qty);
    const parsedPkg = parseFloat(pkgSize);
    const parsedPaid = parseFloat(paidPrice);
    const parsedReg = regularPrice.trim() !== '' ? parseFloat(regularPrice) : undefined;

    if (isNaN(parsedQty) || parsedQty <= 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }
    if (isNaN(parsedPkg) || parsedPkg <= 0) {
      setFormError('Package size must be greater than zero.');
      return;
    }
    if (isNaN(parsedPaid) || parsedPaid < 0) {
      setFormError('Enter a valid paid price.');
      return;
    }
    if (parsedReg !== undefined && (isNaN(parsedReg) || parsedReg < 0)) {
      setFormError('Regular price must be >= 0.');
      return;
    }

    const payload: DraftItemInput = {
      product_id: selectedProductId,
      product_name: productName,
      brand_name: brandName,
      quantity: parsedQty,
      unit,
      package_size: parsedPkg,
      paid_price: parsedPaid,
      regular_price: parsedReg,
      is_discount:
        isDiscount || (parsedReg !== undefined && parsedPaid < parsedReg),
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

  const previewLineTotal =
    Math.round((parseFloat(qty) || 0) * (parseFloat(paidPrice) || 0) * 100) / 100;

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
            Product *
          </label>
          <ProductCombobox
            selectedProductName={productName}
            onSelect={applyProductSelection}
            onClearSelection={() => {
              setSelectedProductId(null);
              setProductName('');
              setBrandName(undefined);
            }}
            onRequestCreate={initialName => {
              setModalInitialName(initialName);
              setModalOpen(true);
            }}
            inputRef={productInputRef}
            placeholder="Search or create product..."
            inputClassName="min-h-[44px]"
            onDropdownOpenChange={setComboboxOpen}
            extraCreatedProduct={lastCreatedProduct}
          />
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Qty</label>
            <input
              ref={qtyInputRef}
              type="number"
              step="any"
              min="0.001"
              value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Unit</label>
            <select
              value={unit}
              onChange={e => setUnit(e.target.value as MeasureUnit)}
              className="w-full min-h-[44px] px-2.5 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              {MEASURE_UNITS.map(u => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Pkg Size
            </label>
            <input
              type="number"
              step="any"
              min="0.001"
              value={pkgSize}
              onChange={e => setPkgSize(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Paid Price (€) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={paidPrice}
              onChange={e => setPaidPrice(e.target.value)}
              onKeyDown={handlePriceKeyDown}
              className="w-full min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Regular Price (€)
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
            No items logged yet. Search a product on the active card and press{' '}
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
                        {item.quantity} × €{item.paid_price.toFixed(2)} • {item.package_size}{' '}
                        {item.unit}
                        {item.brand_name ? ` • ${item.brand_name}` : ''}
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

      <InlineProductModal
        isOpen={modalOpen}
        initialName={modalInitialName}
        onClose={() => setModalOpen(false)}
        onCreated={created => {
          setLastCreatedProduct(created);
          applyProductSelection(created);
        }}
      />
    </div>
  );
};
