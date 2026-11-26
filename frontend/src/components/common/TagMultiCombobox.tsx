import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, Tag as TagIcon, X } from 'lucide-react';
import { api } from '../../api/client';
import { Tag, TagImplication } from '../../types';
import { getEffectiveTagsForIds } from '../workbench/productUtils';

interface TagMultiComboboxProps {
  tags: Tag[];
  implications: TagImplication[];
  selectedTagIds: number[];
  onChange: (nextTagIds: number[]) => void;
  onTagCreated: (tag: Tag) => void;
  placeholder?: string;
}

export const TagMultiCombobox: React.FC<TagMultiComboboxProps> = ({
  tags,
  implications,
  selectedTagIds,
  onChange,
  onTagCreated,
  placeholder = 'Search or create Firefly tags...',
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
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

  const selectedSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const tagsById = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);

  const selectedTags = useMemo(
    () => selectedTagIds.map(id => tagsById.get(id)).filter((t): t is Tag => Boolean(t)),
    [selectedTagIds, tagsById]
  );

  const effectivePreview = useMemo(
    () => getEffectiveTagsForIds(selectedTagIds, tags, implications),
    [selectedTagIds, tags, implications]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags.filter(t => {
      if (selectedSet.has(t.id)) return false;
      return q ? t.name.toLowerCase().includes(q) : true;
    });
  }, [tags, selectedSet, query]);

  const trimmedQuery = query.trim();
  const exactExisting = useMemo(
    () =>
      trimmedQuery
        ? tags.find(t => t.name.trim().toLowerCase() === trimmedQuery.toLowerCase())
        : undefined,
    [tags, trimmedQuery]
  );
  const canCreate = Boolean(trimmedQuery) && !exactExisting;

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
  }, [isOpen, updateDropdownPosition, selectedTagIds.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inContainer = containerRef.current?.contains(target) ?? false;
      const inDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!inContainer && !inDropdown) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, filteredOptions.length]);

  const handleSelectTag = (tag: Tag) => {
    if (!selectedSet.has(tag.id)) {
      onChange([...selectedTagIds, tag.id]);
    }
    setQuery('');
    setError(null);
    inputRef.current?.focus();
  };

  const handleRemoveTag = (tagId: number) => {
    onChange(selectedTagIds.filter(id => id !== tagId));
    inputRef.current?.focus();
  };

  const handleCreateMissingTag = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.tags.create({ name: trimmedQuery });
      onTagCreated(created);
      if (!selectedSet.has(created.id)) {
        onChange([...selectedTagIds, created.id]);
      }
      setQuery('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Firefly tag');
    } finally {
      setCreating(false);
    }
  };

  const totalChoices = filteredOptions.length + (canCreate ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }

    if (e.key === 'Backspace' && !query && selectedTagIds.length > 0) {
      e.preventDefault();
      onChange(selectedTagIds.slice(0, -1));
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else if (totalChoices > 0) {
        setHighlightIndex(prev => Math.min(prev + 1, totalChoices - 1));
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (highlightIndex < filteredOptions.length && filteredOptions[highlightIndex]) {
        handleSelectTag(filteredOptions[highlightIndex]);
      } else if (canCreate) {
        handleCreateMissingTag();
      } else if (exactExisting && !selectedSet.has(exactExisting.id)) {
        handleSelectTag(exactExisting);
      }
    }
  };

  const dropdownMenu =
    isOpen && dropdownRect && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
            }}
            className="bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] max-h-60 overflow-y-auto"
          >
            {filteredOptions.length === 0 && !canCreate ? (
              <div className="px-3 py-2 text-xs text-slate-400">
                {tags.length === 0
                  ? 'Type a name to create your first Firefly tag.'
                  : 'No remaining tags match your search.'}
              </div>
            ) : (
              filteredOptions.slice(0, 30).map((tag, idx) => {
                const { implied } = getEffectiveTagsForIds([tag.id], tags, implications);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault();
                      handleSelectTag(tag);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition ${
                      idx === highlightIndex
                        ? 'bg-blue-50 text-blue-900'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <span className="font-semibold">#{tag.name}</span>
                    {implied.length > 0 && (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded truncate max-w-[180px]">
                        → {implied.map(i => i.name).join(', ')}
                      </span>
                    )}
                  </button>
                );
              })
            )}

            {canCreate && (
              <button
                type="button"
                disabled={creating}
                onMouseDown={e => {
                  e.preventDefault();
                  handleCreateMissingTag();
                }}
                className={`w-full text-left px-3 py-2.5 text-xs font-semibold border-t border-slate-100 flex items-center text-blue-600 hover:bg-blue-50 sticky bottom-0 bg-white ${
                  highlightIndex >= filteredOptions.length ? 'bg-blue-50' : ''
                }`}
              >
                <Plus className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                <span>
                  {creating ? 'Creating...' : `Create Firefly tag "${trimmedQuery}"`}
                </span>
              </button>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onClick={() => {
          inputRef.current?.focus();
          updateDropdownPosition();
          setIsOpen(true);
        }}
        className="p-2 border border-slate-300 rounded-xl bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition min-h-[44px] flex flex-wrap items-center gap-1.5 cursor-text"
      >
        {selectedTags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200"
          >
            <span>#{tag.name}</span>
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                handleRemoveTag(tag.id);
              }}
              className="text-blue-600 hover:text-blue-900 rounded-full p-0.5 hover:bg-blue-100"
              title={`Remove ${tag.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        <div className="relative flex-1 min-w-[140px] flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => {
              updateDropdownPosition();
              setIsOpen(true);
            }}
            onChange={e => {
              setQuery(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={selectedTags.length === 0 ? placeholder : 'Add more tags...'}
            autoComplete="off"
            className="w-full py-0.5 text-xs text-slate-800 bg-transparent border-none outline-none focus:ring-0 placeholder:text-slate-400"
          />
        </div>
      </div>

      {effectivePreview.implied.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
          <TagIcon className="w-3 h-3 text-emerald-600" />
          <span>Auto-implied on Firefly:</span>
          {effectivePreview.implied.map(t => (
            <span
              key={t.id}
              className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium"
            >
              +{t.name}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-600 font-medium">{error}</p>
      )}

      {dropdownMenu}
    </div>
  );
};
