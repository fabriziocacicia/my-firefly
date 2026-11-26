import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Search, X } from 'lucide-react';
import { api } from '../../api/client';
import { Tag } from '../../types';

export interface TagComboboxProps {
  tags: Tag[];
  value: number | null;
  onChange: (tagId: number | null) => void;
  onTagCreated?: (tag: Tag) => void;
  excludeTagId?: number | null;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

export const TagCombobox: React.FC<TagComboboxProps> = ({
  tags,
  value,
  onChange,
  onTagCreated,
  excludeTagId = null,
  placeholder = 'Search tag...',
  ariaLabel,
  className = '',
}) => {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const selectedTag = useMemo(
    () => (value != null ? tags.find(t => t.id === value) ?? null : null),
    [tags, value]
  );

  const [inputValue, setInputValue] = useState(selectedTag?.name || '');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(selectedTag?.name || '');
  }, [selectedTag]);

  const query = isOpen
    ? inputValue.trim().toLowerCase() === (selectedTag?.name.trim().toLowerCase() || '')
      ? ''
      : inputValue.trim().toLowerCase()
    : '';

  const filteredTags = useMemo(() => {
    return tags.filter(t => {
      if (excludeTagId != null && t.id === excludeTagId) return false;
      return query ? t.name.toLowerCase().includes(query) : true;
    });
  }, [tags, excludeTagId, query]);

  const trimmedInput = inputValue.trim();
  const exactExisting = useMemo(
    () =>
      trimmedInput
        ? tags.find(t => t.name.trim().toLowerCase() === trimmedInput.toLowerCase())
        : undefined,
    [tags, trimmedInput]
  );
  const canCreate = Boolean(onTagCreated) && Boolean(trimmedInput) && !exactExisting;
  const totalOptions = filteredTags.length + (canCreate ? 1 : 0);

  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target) ?? false;
      const inDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!inContainer && !inDropdown) {
        setIsOpen(false);
        setInputValue(selectedTag?.name || '');
        setError(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [selectedTag]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filteredTags.length]);

  const handleSelectTag = (tag: Tag) => {
    onChange(tag.id);
    setInputValue(tag.name);
    setIsOpen(false);
    setError(null);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setInputValue('');
    setError(null);
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const handleCreateTag = async () => {
    if (!canCreate || creating || !onTagCreated) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.tags.create({ name: trimmedInput });
      onTagCreated(created);
      onChange(created.id);
      setInputValue(created.name);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tag');
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setInputValue(selectedTag?.name || '');
      return;
    }

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalOptions > 0) {
        setActiveIndex(i => (i + 1) % totalOptions);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalOptions > 0) {
        setActiveIndex(i => (i - 1 + totalOptions) % totalOptions);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex < filteredTags.length) {
        handleSelectTag(filteredTags[activeIndex]);
      } else if (canCreate) {
        handleCreateTag();
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
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
          aria-label={ariaLabel || placeholder}
          value={inputValue}
          onFocus={() => {
            setIsOpen(true);
            setInputValue('');
          }}
          onClick={() => {
            if (!isOpen) {
              setIsOpen(true);
              setInputValue('');
            }
          }}
          onChange={e => {
            setInputValue(e.target.value);
            if (!isOpen) setIsOpen(true);
            if (value != null && !e.target.value.trim()) {
              onChange(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={selectedTag ? selectedTag.name : placeholder}
          className={`w-full pl-8 pr-7 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            selectedTag && !isOpen ? 'font-semibold text-slate-900' : 'text-slate-700'
          }`}
        />
        {(value != null || inputValue) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 p-0.5 rounded text-slate-400 hover:text-slate-700"
            aria-label="Clear selected tag"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen &&
        dropdownRect &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: Math.max(dropdownRect.width, 220),
            }}
            className="z-[80] bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
          >
            <ul
              id={listboxId}
              role="listbox"
              className="max-h-60 overflow-y-auto divide-y divide-slate-100 text-xs"
            >
              {filteredTags.length === 0 && !canCreate ? (
                <li className="px-3 py-2.5 text-slate-400 text-center">
                  No matching tags
                </li>
              ) : (
                filteredTags.map((tag, idx) => {
                  const isSelected = tag.id === value;
                  const isHighlighted = idx === activeIndex;
                  return (
                    <li key={tag.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault();
                          handleSelectTag(tag);
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between transition ${
                          isHighlighted
                            ? 'bg-blue-50 text-blue-900'
                            : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <span className="truncate font-medium">#{tag.name}</span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })
              )}

              {canCreate && (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    disabled={creating}
                    onMouseDown={e => {
                      e.preventDefault();
                      handleCreateTag();
                    }}
                    onMouseEnter={() => setActiveIndex(filteredTags.length)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-1.5 font-semibold text-emerald-700 ${
                      activeIndex === filteredTags.length
                        ? 'bg-emerald-50'
                        : 'hover:bg-emerald-50'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {creating ? 'Creating tag...' : `Create "#${trimmedInput}" in Firefly`}
                    </span>
                  </button>
                </li>
              )}
            </ul>
            {error && (
              <div className="px-3 py-1.5 bg-rose-50 border-t border-rose-200 text-[11px] text-rose-700">
                {error}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
