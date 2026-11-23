import React, { useState, useEffect, useRef, useId } from 'react';
import { Tag as TagIcon, X, Plus, Check } from 'lucide-react';
import { api } from '../../api/client';

export interface CategoryComboboxProps {
  selectedCategory: string | null;
  onChange: (category: string | null) => void;
  categories?: string[];
  disabled?: boolean;
  placeholder?: string;
  size?: 'sm' | 'md';
  id?: string;
  className?: string;
}

export const CategoryCombobox: React.FC<CategoryComboboxProps> = ({
  selectedCategory,
  onChange,
  categories: propCategories,
  disabled = false,
  placeholder = 'Add or select category...',
  size = 'md',
  id: customId,
  className = '',
}) => {
  const generatedId = useId();
  const inputId = customId || `category-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const [availableCategories, setAvailableCategories] = useState<string[]>(propCategories || []);
  const [inputValue, setInputValue] = useState(selectedCategory || '');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  // Sync internal input value with prop
  useEffect(() => {
    setInputValue(selectedCategory || '');
  }, [selectedCategory]);

  // Load categories if not supplied in props
  useEffect(() => {
    if (propCategories !== undefined) {
      setAvailableCategories(propCategories);
      return;
    }

    let isMounted = true;
    api.categories
      .list()
      .then((cats) => {
        if (isMounted) setAvailableCategories(cats);
      })
      .catch((err) => {
        console.error('Failed to load categories:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [propCategories]);

  // Outside click listener
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setInputValue(selectedCategory || '');
        setActiveIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [selectedCategory]);

  const trimmed = inputValue.trim();
  const query = trimmed.toLowerCase();

  const matchingCategories = availableCategories.filter((cat) =>
    query ? cat.toLowerCase().includes(query) : true
  );

  const exactMatchExists = availableCategories.some(
    (cat) => cat.trim().toLowerCase() === query
  );

  const showCreateOption = trimmed.length > 0 && !exactMatchExists;

  type Option =
    | { type: 'clear' }
    | { type: 'category'; name: string }
    | { type: 'create'; name: string };

  const allOptions: Option[] = [
    ...(selectedCategory ? [{ type: 'clear' as const }] : []),
    ...matchingCategories.map((name) => ({ type: 'category' as const, name })),
    ...(showCreateOption ? [{ type: 'create' as const, name: trimmed }] : []),
  ];

  const handleSelectOption = (option: Option) => {
    if (option.type === 'clear') {
      setInputValue('');
      setIsOpen(false);
      setActiveIndex(-1);
      onChange(null);
    } else if (option.type === 'category') {
      setInputValue(option.name);
      setIsOpen(false);
      setActiveIndex(-1);
      onChange(option.name);
    } else if (option.type === 'create') {
      const newCat = option.name.trim();
      setInputValue(newCat);
      setIsOpen(false);
      setActiveIndex(-1);
      if (!availableCategories.some((c) => c.toLowerCase() === newCat.toLowerCase())) {
        setAvailableCategories((prev) => [...prev, newCat].sort((a, b) => a.localeCompare(b)));
      }
      onChange(newCat);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < allOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : allOptions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < allOptions.length) {
          handleSelectOption(allOptions[activeIndex]);
        } else if (trimmed) {
          handleSelectOption({ type: 'create', name: trimmed });
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setInputValue(selectedCategory || '');
        setActiveIndex(-1);
        break;
      case 'Tab':
        setIsOpen(false);
        setInputValue(selectedCategory || '');
        setActiveIndex(-1);
        break;
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInputValue('');
    onChange(null);
    if (inputRef.current) inputRef.current.focus();
  };

  const renderHighlighted = (name: string, q: string) => {
    const term = q.trim();
    if (!term) return name;
    const lowerName = name.toLowerCase();
    const idx = lowerName.indexOf(term.toLowerCase());
    if (idx === -1) return name;

    const before = name.slice(0, idx);
    const match = name.slice(idx, idx + term.length);
    const after = name.slice(idx + term.length);

    return (
      <>
        {before}
        <strong className="text-indigo-600 font-bold underline underline-offset-2">
          {match}
        </strong>
        {after}
      </>
    );
  };

  const isSmall = size === 'sm';
  const hasValue = Boolean(inputValue.trim() || selectedCategory);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <div
          className={`absolute inset-y-0 left-0 flex items-center pointer-events-none text-slate-400 ${
            isSmall ? 'pl-2' : 'pl-3'
          }`}
        >
          <TagIcon className={isSmall ? 'w-3 h-3' : 'w-4 h-4'} />
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
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (!isOpen) setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => {
            if (!disabled) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className={`w-full bg-white border border-slate-300 rounded-lg shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 text-slate-900 placeholder:text-slate-400 ${
            isSmall
              ? 'pl-7 pr-6 py-1 text-xs'
              : 'pl-9 pr-8 py-2 text-sm'
          } ${disabled ? 'bg-slate-100 cursor-not-allowed opacity-60' : ''}`}
        />

        {hasValue && !disabled && (
          <button
            type="button"
            aria-label="Clear category"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
            className={`absolute inset-y-0 right-0 flex items-center text-slate-400 hover:text-slate-600 transition-colors ${
              isSmall ? 'pr-2' : 'pr-2.5'
            }`}
          >
            <X className={isSmall ? 'w-3 h-3' : 'w-4 h-4'} />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100 max-h-52 overflow-y-auto">
          <ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label="Category suggestions"
            className="divide-y divide-slate-100 text-xs py-1"
          >
            {allOptions.length === 0 ? (
              <li className="px-3 py-2 text-slate-400 text-center italic">
                Type to create a category...
              </li>
            ) : (
              allOptions.map((opt, idx) => {
                const isSelected = activeIndex === idx;

                if (opt.type === 'clear') {
                  return (
                    <li
                      key="clear"
                      role="option"
                      aria-selected={false}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleSelectOption(opt)}
                      className={`px-3 py-1.5 flex items-center justify-between cursor-pointer transition-colors text-slate-500 hover:bg-slate-50 ${
                        isSelected ? 'bg-slate-100' : ''
                      }`}
                    >
                      <span className="italic">No Category (Clear)</span>
                    </li>
                  );
                }

                if (opt.type === 'create') {
                  return (
                    <li
                      key={`create-${opt.name}`}
                      role="option"
                      aria-selected={false}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleSelectOption(opt)}
                      className={`px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100/70 font-medium ${
                        isSelected ? 'bg-indigo-100' : ''
                      }`}
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Create &quot;<strong>{opt.name}</strong>&quot;
                      </span>
                    </li>
                  );
                }

                const isCurrent =
                  selectedCategory?.toLowerCase() === opt.name.toLowerCase();

                return (
                  <li
                    key={opt.name}
                    role="option"
                    aria-selected={isCurrent}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelectOption(opt)}
                    className={`px-3 py-1.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-900'
                        : isCurrent
                        ? 'bg-slate-50 font-medium text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{renderHighlighted(opt.name, inputValue)}</span>
                    {isCurrent && (
                      <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
