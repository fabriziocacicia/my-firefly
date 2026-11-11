import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '../../api/client';
import { MeasureUnit, Product } from '../../types';

export const MEASURE_UNITS: MeasureUnit[] = ['g', 'kg', 'ml', 'l', 'pcs'];

export function toMeasureUnit(unit?: string): MeasureUnit {
  const clean = (unit || '').toLowerCase().trim();
  if (clean === 'g' || clean === 'kg' || clean === 'ml' || clean === 'l' || clean === 'pcs') {
    return clean;
  }
  return 'pcs';
}

interface ProductComboboxProps {
  selectedProductName: string;
  onSelect: (product: Product) => void;
  onClearSelection?: () => void;
  onRequestCreate: (initialSearch: string) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  placeholder?: string;
  inputClassName?: string;
  onDropdownOpenChange?: (isOpen: boolean) => void;
  extraCreatedProduct?: Product | null;
}

export const ProductCombobox: React.FC<ProductComboboxProps> = ({
  selectedProductName,
  onSelect,
  onClearSelection,
  onRequestCreate,
  inputRef,
  placeholder = 'Search product...',
  inputClassName = '',
  onDropdownOpenChange,
  extraCreatedProduct,
}) => {
  const [query, setQuery] = useState(selectedProductName);
  const [results, setResults] = useState<Product[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selectedProductName);
  }, [selectedProductName]);

  useEffect(() => {
    onDropdownOpenChange?.(isOpen);
  }, [isOpen, onDropdownOpenChange]);

  useEffect(() => {
    if (!extraCreatedProduct) return;
    setResults(prev =>
      prev.some(p => p.id === extraCreatedProduct.id)
        ? prev
        : [extraCreatedProduct, ...prev]
    );
  }, [extraCreatedProduct]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced product lookup (150ms)
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const list = await api.products.list({
          search: query.trim() || undefined,
        });
        setResults(list.slice(0, 20));
        setHighlightIndex(0);
      } catch (err) {
        console.error('Product autocomplete search failed:', err);
      } finally {
        setIsLoading(false);
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [query, isOpen]);

  const handleSelectProduct = (product: Product) => {
    setQuery(product.name);
    setIsOpen(false);
    onSelect(product);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightIndex(prev => Math.min(prev + 1, results.length));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter' && isOpen) {
      e.preventDefault();
      if (highlightIndex < results.length && results[highlightIndex]) {
        handleSelectProduct(results[highlightIndex]);
      } else {
        setIsOpen(false);
        onRequestCreate(query.trim());
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={e => {
            const nextVal = e.target.value;
            setQuery(nextVal);
            if (selectedProductName && nextVal !== selectedProductName) {
              onClearSelection?.();
            }
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputClassName}`}
        />
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-40 max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-slate-400">Searching catalog...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">No matching products found.</div>
          ) : (
            results.map((prod, idx) => (
              <button
                key={prod.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  handleSelectProduct(prod);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition ${
                  idx === highlightIndex
                    ? 'bg-blue-50 text-blue-900'
                    : 'hover:bg-slate-50 text-slate-800'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="font-semibold truncate">{prod.name}</div>
                  {prod.brand && (
                    <div className="text-[11px] text-slate-400 truncate">{prod.brand.name}</div>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 font-medium shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                  {prod.package_size} {prod.default_unit}
                </span>
              </button>
            ))
          )}

          <button
            type="button"
            onMouseDown={e => {
              e.preventDefault();
              setIsOpen(false);
              onRequestCreate(query.trim());
            }}
            className={`w-full text-left px-3 py-2 text-xs font-semibold border-t border-slate-100 flex items-center text-blue-600 hover:bg-blue-50 ${
              highlightIndex >= results.length ? 'bg-blue-50' : ''
            }`}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            New Product{query.trim() ? `: "${query.trim()}"` : ''}
          </button>
        </div>
      )}
    </div>
  );
};
