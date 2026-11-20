import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { Search, X, Loader2, Store as StoreIcon, AlertCircle } from 'lucide-react';
import { api } from '../../api/client';
import { FireflyExpenseAccountBrief } from '../../types';

export interface StoreComboboxProps {
  value: number | null;
  accountNameHint?: string;
  onChange: (id: number | null, name: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  error?: string;
  autoFocus?: boolean;
  required?: boolean;
  id?: string;
}

export const StoreCombobox: React.FC<StoreComboboxProps> = ({
  value,
  accountNameHint,
  onChange,
  disabled = false,
  placeholder = 'Search store or expense account...',
  className = '',
  error,
  autoFocus = false,
  required = false,
  id: customId,
}) => {
  const generatedId = useId();
  const inputId = customId || `store-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const [inputValue, setInputValue] = useState('');
  const [selectedName, setSelectedName] = useState(accountNameHint || '');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<FireflyExpenseAccountBrief[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync selectedName and inputValue when value or accountNameHint changes
  useEffect(() => {
    if (value !== null) {
      if (accountNameHint) {
        setSelectedName(accountNameHint);
        setInputValue(accountNameHint);
      } else if (!selectedName) {
        // Resolve name asynchronously if hint is not provided
        let isMounted = true;
        api.firefly
          .getExpenseAccount(value)
          .then((acc) => {
            if (isMounted && acc) {
              setSelectedName(acc.name);
              setInputValue(acc.name);
            }
          })
          .catch(() => {
            if (isMounted) {
              const fallback = `Account #${value}`;
              setSelectedName(fallback);
              setInputValue(fallback);
            }
          });
        return () => {
          isMounted = false;
        };
      } else {
        setInputValue(selectedName);
      }
    } else {
      setSelectedName('');
      setInputValue('');
    }
  }, [value, accountNameHint]);

  // Execute live search with debouncing and AbortController
  const executeSearch = useCallback((query: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setFetchError(null);

    api.firefly
      .searchExpenseAccounts(query.trim(), 10, controller.signal)
      .then((data) => {
        setResults(data);
        setLoading(false);
        setActiveIndex(data.length > 0 ? 0 : -1);
      })
      .catch((err: any) => {
        if (err.name === 'AbortError') return;
        setLoading(false);
        setFetchError(err.message || 'Failed to search expense accounts');
        setResults([]);
      });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputValue(text);
    setIsOpen(true);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      executeSearch(text);
    }, 150);
  };

  const handleFocus = () => {
    if (disabled) return;
    setIsOpen(true);
    // Initial fetch on focus to show top candidates
    executeSearch(inputValue);
  };

  const handleSelect = (account: FireflyExpenseAccountBrief) => {
    setSelectedName(account.name);
    setInputValue(account.name);
    setIsOpen(false);
    setActiveIndex(-1);
    onChange(account.id, account.name);
    inputRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedName('');
    setInputValue('');
    setResults([]);
    setIsOpen(false);
    setActiveIndex(-1);
    onChange(null, '');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
        executeSearch(inputValue);
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (results.length > 0) {
          setActiveIndex((prev) => (prev + 1) % results.length);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (results.length > 0) {
          setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && activeIndex >= 0 && results[activeIndex]) {
          handleSelect(results[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        setInputValue(selectedName);
        break;
      case 'Tab':
        setIsOpen(false);
        setInputValue(selectedName);
        break;
      default:
        break;
    }
  };

  // Close on outside click and revert unselected text
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
        setInputValue(selectedName);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [selectedName]);

  // Scroll active option into view
  useEffect(() => {
    if (isOpen && activeIndex >= 0 && listboxRef.current) {
      const activeEl = listboxRef.current.children[activeIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex]);

  // Helper to highlight matching substrings
  const renderHighlightedName = (name: string, query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return name;
    const lowerName = name.toLowerCase();
    const lowerQuery = trimmed.toLowerCase();
    const matchIndex = lowerName.indexOf(lowerQuery);
    if (matchIndex === -1) return name;

    const before = name.slice(0, matchIndex);
    const match = name.slice(matchIndex, matchIndex + trimmed.length);
    const after = name.slice(matchIndex + trimmed.length);

    return (
      <>
        {before}
        <strong className="text-indigo-600 font-bold underline underline-offset-2">{match}</strong>
        {after}
      </>
    );
  };

  const hasValue = value !== null || inputValue.trim().length > 0;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className={`w-full pl-9 pr-8 py-2 text-sm bg-white border rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 ${
            error
              ? 'border-red-400 bg-red-50/20 text-red-900 focus:border-red-500 focus:ring-red-500/20'
              : 'border-slate-300 text-slate-900 placeholder:text-slate-400'
          } ${disabled ? 'bg-slate-100 cursor-not-allowed opacity-60' : ''}`}
        />

        {hasValue && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100">
          {fetchError ? (
            <div className="p-3 text-xs text-red-600 flex items-center justify-between">
              <span>{fetchError}</span>
              <button
                type="button"
                onClick={() => executeSearch(inputValue)}
                className="text-indigo-600 hover:underline font-medium ml-2"
              >
                Retry
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                  <span>Searching Firefly accounts...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <p>No matching stores found in Firefly III.</p>
                  <p className="text-slate-400">
                    Try another keyword or verify your expense accounts in Firefly.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <ul
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label="Store suggestions"
              className="max-h-60 overflow-y-auto divide-y divide-slate-100 text-sm py-1"
            >
              {results.map((acc, index) => {
                const isSelected = acc.id === value;
                const isActive = index === activeIndex;

                return (
                  <li
                    key={acc.id}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(e) => {
                      // Prevent input blur before click handler completes
                      e.preventDefault();
                      handleSelect(acc);
                    }}
                    className={`px-3 py-2 cursor-pointer flex items-center justify-between transition-colors ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-900 font-medium'
                        : 'text-slate-800 hover:bg-slate-50'
                    } ${isSelected ? 'bg-indigo-50/60 font-semibold' : ''}`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <StoreIcon
                        className={`w-4 h-4 shrink-0 ${
                          isSelected ? 'text-indigo-600' : 'text-slate-400'
                        }`}
                      />
                      <span className="truncate">
                        {renderHighlightedName(acc.name, inputValue)}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono shrink-0 ml-2">
                      #{acc.id}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
