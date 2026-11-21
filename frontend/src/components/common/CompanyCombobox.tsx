import React, { useState, useEffect, useRef, useId } from 'react';
import { Building2, X, Plus, Store, Check } from 'lucide-react';
import { Company } from '../../types';

export interface CompanySelection {
  companyId: number | null;
  companyName: string;
  isNew?: boolean;
}

export interface CompanyComboboxProps {
  companies: Company[];
  selectedCompanyId: number | null;
  initialNewName?: string;
  onChange: (selection: CompanySelection) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
}

export const CompanyCombobox: React.FC<CompanyComboboxProps> = ({
  companies,
  selectedCompanyId,
  initialNewName = '',
  onChange,
  disabled = false,
  placeholder = 'Search or create company (e.g. Conad, Lidl)...',
  id: customId,
  className = '',
}) => {
  const generatedId = useId();
  const inputId = customId || `company-combobox-${generatedId}`;
  const listboxId = `${inputId}-listbox`;

  const getInitialName = () => {
    if (initialNewName) return initialNewName;
    if (selectedCompanyId) {
      const match = companies.find((c) => c.id === selectedCompanyId);
      if (match) return match.name;
    }
    return '';
  };

  const [inputValue, setInputValue] = useState(getInitialName);
  const [selectedName, setSelectedName] = useState(getInitialName);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const isClearingRef = useRef(false);

  // Sync when selectedCompanyId or initialNewName prop changes
  useEffect(() => {
    const updated = getInitialName();
    setSelectedName(updated);
    setInputValue(updated);
  }, [selectedCompanyId, initialNewName, companies]);

  // Filter matching companies in real time
  const trimmed = inputValue.trim();
  const query = trimmed.toLowerCase();

  const matchingCompanies = companies.filter((c) =>
    query ? c.name.toLowerCase().includes(query) : true
  );

  const exactMatchExists = companies.some(
    (c) => c.name.trim().toLowerCase() === query
  );

  const showCreateOption = trimmed.length > 0 && !exactMatchExists;

  // Flatten options for arrow-key navigation:
  // Index 0: Independent (unlink)
  // Index 1..N: matchingCompanies
  // Index N+1 (optional): create new company
  type ComboboxOption =
    | { type: 'independent' }
    | { type: 'company'; company: Company }
    | { type: 'create'; name: string };

  const allOptions: ComboboxOption[] = [
    { type: 'independent' },
    ...matchingCompanies.map((company) => ({ type: 'company' as const, company })),
    ...(showCreateOption ? [{ type: 'create' as const, name: trimmed }] : []),
  ];

  const handleSelectOption = (option: ComboboxOption) => {
    if (option.type === 'independent') {
      setSelectedName('');
      setInputValue('');
      setIsOpen(false);
      setActiveIndex(-1);
      onChange({ companyId: null, companyName: '', isNew: false });
    } else if (option.type === 'company') {
      setSelectedName(option.company.name);
      setInputValue(option.company.name);
      setIsOpen(false);
      setActiveIndex(-1);
      onChange({
        companyId: option.company.id,
        companyName: option.company.name,
        isNew: false,
      });
    } else {
      setSelectedName(option.name);
      setInputValue(option.name);
      setIsOpen(false);
      setActiveIndex(-1);
      onChange({ companyId: null, companyName: option.name, isNew: true });
    }
    inputRef.current?.focus();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isClearingRef.current = true;
    if (inputRef.current) inputRef.current.value = '';
    setSelectedName('');
    setInputValue('');
    setIsOpen(false);
    setActiveIndex(-1);
    onChange({ companyId: null, companyName: '', isNew: false });
    inputRef.current?.focus();
    setTimeout(() => {
      isClearingRef.current = false;
    }, 50);
  };

  const handleFocus = () => {
    if (disabled || isClearingRef.current) return;
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(0);
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (allOptions.length > 0) {
          setActiveIndex((prev) => (prev + 1) % allOptions.length);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (allOptions.length > 0) {
          setActiveIndex((prev) =>
            prev <= 0 ? allOptions.length - 1 : prev - 1
          );
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen && activeIndex >= 0 && allOptions[activeIndex]) {
          handleSelectOption(allOptions[activeIndex]);
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
        break;
      default:
        break;
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
        setInputValue(selectedName);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedName]);

  // Scroll active option into view
  useEffect(() => {
    if (isOpen && activeIndex >= 0 && listboxRef.current) {
      const activeEl = listboxRef.current.children[activeIndex] as
        | HTMLElement
        | undefined;
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex]);

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

  const hasValue = inputValue.trim().length > 0 || selectedCompanyId !== null;

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
          <Building2 className="w-4 h-4" />
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
            isOpen && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (!isOpen) setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className={`w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-300 rounded-lg shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 text-slate-900 placeholder:text-slate-400 ${
            disabled ? 'bg-slate-100 cursor-not-allowed opacity-60' : ''
          }`}
        />

        {hasValue && !disabled && (
          <button
            type="button"
            aria-label="Clear company selection"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClear}
            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95 duration-100 max-h-60 overflow-y-auto">
          <ul
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label="Company suggestions"
            className="divide-y divide-slate-100 text-sm py-1"
          >
            {/* Option 0: Independent (Unlink) */}
            <li
              id={`${listboxId}-option-0`}
              role="option"
              aria-selected={!selectedCompanyId && !inputValue.trim()}
              onMouseEnter={() => setActiveIndex(0)}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectOption(allOptions[0]);
              }}
              className={`px-3 py-2 cursor-pointer flex items-center justify-between transition-colors ${
                activeIndex === 0
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-2 text-slate-600">
                <Store className="w-4 h-4 text-slate-400 shrink-0" />
                <span>No parent company (Independent)</span>
              </div>
              {!selectedCompanyId && !inputValue.trim() && (
                <Check className="w-4 h-4 text-slate-500 shrink-0" />
              )}
            </li>

            {/* Matching existing companies */}
            {matchingCompanies.map((comp, idx) => {
              const optionIndex = idx + 1;
              const isSelected = comp.id === selectedCompanyId;
              const isActive = optionIndex === activeIndex;

              return (
                <li
                  key={comp.id}
                  id={`${listboxId}-option-${optionIndex}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(optionIndex)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectOption({ type: 'company', company: comp });
                  }}
                  className={`px-3 py-2 cursor-pointer flex items-center justify-between transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-900 font-medium'
                      : 'text-slate-800 hover:bg-slate-50'
                  } ${isSelected ? 'bg-indigo-50/60 font-semibold' : ''}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Building2
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">
                      {renderHighlighted(comp.name, inputValue)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-xs text-slate-400">
                      {comp.store_count ?? 0}{' '}
                      {comp.store_count === 1 ? 'store' : 'stores'}
                    </span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                    )}
                  </div>
                </li>
              );
            })}

            {/* Option to create new company if query doesn't match */}
            {showCreateOption && (
              <li
                id={`${listboxId}-option-${allOptions.length - 1}`}
                role="option"
                onMouseEnter={() => setActiveIndex(allOptions.length - 1)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectOption({ type: 'create', name: trimmed });
                }}
                className={`px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors border-t border-slate-100 ${
                  activeIndex === allOptions.length - 1
                    ? 'bg-indigo-50 text-indigo-900 font-medium'
                    : 'text-indigo-600 hover:bg-indigo-50/60'
                }`}
              >
                <Plus className="w-4 h-4 text-indigo-600 shrink-0" />
                <span className="truncate">
                  Create new company "<strong>{trimmed}</strong>"
                </span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
