import React, { useRef, useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { DraftItemInput, useReceiptWorkbench } from '../../context/ReceiptWorkbenchContext';
import { DraftReceiptItem, MeasureUnit, Product } from '../../types';
import { InlineProductModal } from './InlineProductModal';
import { MEASURE_UNITS, ProductCombobox, toMeasureUnit } from './ProductCombobox';

export const TabularGridView: React.FC = () => {
  const { draftItems, addItem, updateItem, removeItem } = useReceiptWorkbench();

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productLabel, setProductLabel] = useState('');
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
  const [activeRowError, setActiveRowError] = useState<string | null>(null);

  const productInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const resetActiveRow = () => {
    setSelectedProduct(null);
    setProductLabel('');
    setQty('1');
    setUnit('pcs');
    setPkgSize('1');
    setPaidPrice('');
    setRegularPrice('');
    setIsDiscount(false);
    setActiveRowError(null);
  };

  const applyProductToActiveRow = (prod: Product) => {
    setSelectedProduct(prod);
    setProductLabel(prod.name);
    setUnit(toMeasureUnit(prod.default_unit));
    setPkgSize(String(prod.package_size > 0 ? prod.package_size : 1));
    setQty('1');
    setActiveRowError(null);
    window.setTimeout(() => qtyInputRef.current?.focus(), 0);
  };

  const commitActiveRow = () => {
    if (!selectedProduct) {
      setActiveRowError('Select a product first.');
      productInputRef.current?.focus();
      return;
    }
    const parsedQty = parseFloat(qty);
    const parsedPkg = parseFloat(pkgSize);
    const parsedPaid = parseFloat(paidPrice);
    const parsedReg = regularPrice.trim() !== '' ? parseFloat(regularPrice) : undefined;

    if (isNaN(parsedQty) || parsedQty <= 0) {
      setActiveRowError('Qty must be > 0.');
      return;
    }
    if (isNaN(parsedPkg) || parsedPkg <= 0) {
      setActiveRowError('Pkg size must be > 0.');
      return;
    }
    if (isNaN(parsedPaid) || parsedPaid < 0) {
      setActiveRowError('Enter valid paid price.');
      return;
    }
    if (parsedReg !== undefined && (isNaN(parsedReg) || parsedReg < 0)) {
      setActiveRowError('Regular price must be >= 0.');
      return;
    }

    const input: DraftItemInput = {
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      brand_name: selectedProduct.brand?.name,
      quantity: parsedQty,
      unit,
      package_size: parsedPkg,
      paid_price: parsedPaid,
      regular_price: parsedReg,
      is_discount:
        isDiscount || (parsedReg !== undefined && parsedPaid < parsedReg),
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

  const activeLineTotal =
    Math.round((parseFloat(qty) || 0) * (parseFloat(paidPrice) || 0) * 100) / 100;

  const updateExistingNumber = (
    item: DraftReceiptItem,
    field: 'quantity' | 'package_size' | 'paid_price' | 'regular_price',
    raw: string
  ) => {
    if (field === 'regular_price' && raw.trim() === '') {
      updateItem(item.temp_id, { regular_price: undefined });
      return;
    }
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    if ((field === 'quantity' || field === 'package_size') && parsed <= 0) return;
    if ((field === 'paid_price' || field === 'regular_price') && parsed < 0) return;
    updateItem(item.temp_id, { [field]: parsed });
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider text-[11px]">
            <tr>
              <th className="px-3 py-3 text-left font-semibold w-10">#</th>
              <th className="px-3 py-3 text-left font-semibold min-w-[220px]">Product</th>
              <th className="px-2 py-3 text-left font-semibold w-20">Qty</th>
              <th className="px-2 py-3 text-left font-semibold w-20">Unit</th>
              <th className="px-2 py-3 text-left font-semibold w-24">Pkg Size</th>
              <th className="px-2 py-3 text-left font-semibold w-28">Paid Price (€)</th>
              <th className="px-2 py-3 text-left font-semibold w-28">Regular Price (€)</th>
              <th className="px-2 py-3 text-center font-semibold w-20">Discount</th>
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
                  {item.brand_name && (
                    <div className="text-[11px] text-slate-400">{item.brand_name}</div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    value={item.quantity}
                    onChange={e => updateExistingNumber(item, 'quantity', e.target.value)}
                    className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={item.unit}
                    onChange={e =>
                      updateItem(item.temp_id, { unit: e.target.value as MeasureUnit })
                    }
                    className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs bg-white"
                  >
                    {MEASURE_UNITS.map(u => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    value={item.package_size}
                    onChange={e => updateExistingNumber(item, 'package_size', e.target.value)}
                    className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.paid_price}
                    onChange={e => updateExistingNumber(item, 'paid_price', e.target.value)}
                    className="w-full px-2 py-1 border border-slate-200 rounded-md text-xs font-semibold"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Same"
                    value={item.regular_price ?? ''}
                    onChange={e => updateExistingNumber(item, 'regular_price', e.target.value)}
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
                  paidPrice === '' &&
                  productLabel === '' &&
                  (e.target as HTMLElement).tagName !== 'INPUT'
                ) {
                  e.preventDefault();
                  resetActiveRow();
                }
              }}
            >
              <td className="px-3 py-2.5 text-blue-600 font-bold">+</td>
              <td className="px-3 py-2.5 overflow-visible">
                <ProductCombobox
                  selectedProductName={productLabel}
                  onSelect={applyProductToActiveRow}
                  onClearSelection={() => {
                    setSelectedProduct(null);
                    setProductLabel('');
                  }}
                  onRequestCreate={initialName => {
                    setModalInitialName(initialName);
                    setModalOpen(true);
                  }}
                  inputRef={productInputRef}
                  placeholder="Type product name..."
                  onDropdownOpenChange={setComboboxOpen}
                  extraCreatedProduct={lastCreatedProduct}
                />
              </td>
              <td className="px-2 py-2.5">
                <input
                  ref={qtyInputRef}
                  type="number"
                  step="any"
                  min="0.001"
                  value={qty}
                  onChange={e => setQty(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs bg-white"
                />
              </td>
              <td className="px-2 py-2.5">
                <select
                  value={unit}
                  onChange={e => setUnit(e.target.value as MeasureUnit)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs bg-white"
                >
                  {MEASURE_UNITS.map(u => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-2.5">
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  value={pkgSize}
                  onChange={e => setPkgSize(e.target.value)}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs bg-white"
                />
              </td>
              <td className="px-2 py-2.5">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={paidPrice}
                  onChange={e => setPaidPrice(e.target.value)}
                  onKeyDown={handlePriceKeyDown}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs font-semibold bg-white"
                />
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
        cells, press <kbd className="px-1 py-0.5 bg-slate-100 rounded border">Enter</kbd> in Paid or
        Regular Price to commit the row and jump to the next product.
      </p>

      <InlineProductModal
        isOpen={modalOpen}
        initialName={modalInitialName}
        onClose={() => setModalOpen(false)}
        onCreated={created => {
          setLastCreatedProduct(created);
          applyProductToActiveRow(created);
        }}
      />
    </div>
  );
};
