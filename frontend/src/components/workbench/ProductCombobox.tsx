import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../../api/client';
import { usePortalDropdown } from '../../hooks/usePortalDropdown';
import { Product } from '../../types';
import { formatProductBadge } from './productUtils';

interface ProductComboboxProps {
  selectedProductName: string;
  onSelect: (product: Product) => void;
  onClearSelection?: () => void;
  onRequestCreate: (initialName: string) => void;
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
  placeholder = 'Search catalog item...',
  inputClassName = '',
  onDropdownOpenChange,
  extraCreatedProduct = null,
}) => {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const [query, setQuery] = useState(selectedProductName);
  const [settledQuery, setSettledQuery] = useState(selectedProductName);
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const prevSelectedPropRef = useRef(selectedProductName);

  const { containerRef, dropdownRef, dropdownRect, updatePosition } = usePortalDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    minWidth: 280,
    preferredMaxHeight: 288,
  });

  useEffect(() => {
    const prev = prevSelectedPropRef.current;
    prevSelectedPropRef.current = selectedProductName;
    if (selectedProductName && selectedProductName !== prev) {
      setQuery(selectedProductName);
      setSettledQuery(selectedProductName);
    } else if (!selectedProductName && prev && !isOpen) {
      setQuery('');
    }
  }, [selectedProductName, isOpen]);

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

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isOpen]);

  // Debounced product lookup (120ms)
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const requestedQuery = query;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setSearchError(null);
      try {
        const list = await api.products.list({
          search: requestedQuery.trim() || undefined,
        });
        if (!active) return;
        setResults(list.slice(0, 20));
        setSettledQuery(requestedQuery);
        setHighlightIndex(0);
      } catch (err) {
        if (!active) return;
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (active) setIsLoading(false);
      }
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, isOpen]);

  const handleSelectProduct = (product: Product) => {
    setQuery(product.name);
    setSettledQuery(product.name);
    setIsOpen(false);
    onSelect(product);
  };

  const isSearchPending = isLoading || query.trim() !== settledQuery.trim();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (e.key === 'Tab') {
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
      if (isSearchPending) return;
      if (highlightIndex < results.length && results[highlightIndex]) {
        handleSelectProduct(results[highlightIndex]);
      } else {
        setIsOpen(false);
        onRequestCreate(query.trim());
      }
    }
  };

  const activeDescendantId =
    isOpen && highlightIndex <= results.length
      ? `${listboxId}-opt-${highlightIndex}`
      : undefined;

  const dropdownMenu =
    isOpen && dropdownRect && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              maxHeight: dropdownRect.maxHeight,
            }}
            className="bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] overflow-y-auto"
          >
            {isLoading ? (
              <div className="px-3 py-2 text-xs text-slate-400">Searching catalog...</div>
            ) : searchError ? (
              <div className="px-3 py-2 text-xs text-rose-600">{searchError}</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">
                No matching items found.
              </div>
            ) : (
              results.map((prod, idx) => (
                <button
                  key={prod.id}
                  id={`${listboxId}-opt-${idx}`}
                  ref={el => {
                    optionRefs.current[idx] = el;
                  }}
                  role="option"
                  aria-selected={idx === highlightIndex}
                  type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    handleSelectProduct(prod);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition ${
                    idx === highlightIndex
                      ? 'bg-blue-50 text-blue-900'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">
                      {prod.firefly_description || prod.name}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {[prod.brand?.name, prod.firefly_category_name]
                        .filter(Boolean)
                        .join(' · ') || 'Uncategorized'}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-600 font-medium shrink-0 bg-slate-100 px-1.5 py-0.5 rounded">
                    {formatProductBadge(prod)}
                  </span>
                </button>
              ))
            )}

            <button
              id={`${listboxId}-opt-${results.length}`}
              ref={el => {
                optionRefs.current[results.length] = el;
              }}
              role="option"
              aria-selected={highlightIndex >= results.length}
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                setIsOpen(false);
                onRequestCreate(query.trim());
              }}
              className={`w-full text-left px-3 py-2.5 text-xs font-semibold border-t border-slate-100 flex items-center text-blue-600 hover:bg-blue-50 sticky bottom-0 bg-white ${
                highlightIndex >= results.length ? 'bg-blue-50' : ''
              }`}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <span className="truncate">
                New Item{query.trim() ? `: "${query.trim()}"` : ''}
              </span>
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendantId}
          value={query}
          onFocus={() => {
            updatePosition();
            setIsOpen(true);
          }}
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
      {dropdownMenu}
    </div>
  );
};
