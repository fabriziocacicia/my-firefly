import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, Plus, Search, X } from 'lucide-react';
import { api } from '../../api/client';
import { usePortalDropdown } from '../../hooks/usePortalDropdown';
import { Tag, TagImplication } from '../../types';
import {
  getEffectiveTagsForIds,
  getImpliedParentSources,
  pruneRedundantAncestorTagIds,
} from '../workbench/productUtils';

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
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockHint, setLockHint] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  const effectiveSet = useMemo(
    () =>
      new Set([
        ...selectedTagIds,
        ...effectivePreview.implied.map(t => t.id),
      ]),
    [selectedTagIds, effectivePreview.implied]
  );

  const impliedSources = useMemo(
    () => getImpliedParentSources(selectedTagIds, tags, implications),
    [selectedTagIds, tags, implications]
  );

  const { containerRef, dropdownRef, dropdownRect, updatePosition } = usePortalDropdown({
    isOpen,
    onClose: () => setIsOpen(false),
    minWidth: 240,
    preferredMaxHeight: 240,
    deps: [selectedTagIds.length, effectivePreview.implied.length],
  });

  const renderedOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tags
      .filter(t => {
        if (effectiveSet.has(t.id)) return false;
        return q ? t.name.toLowerCase().includes(q) : true;
      })
      .slice(0, 30);
  }, [tags, effectiveSet, query]);

  const trimmedQuery = query.trim();
  const exactExisting = useMemo(
    () =>
      trimmedQuery
        ? tags.find(t => t.name.trim().toLowerCase() === trimmedQuery.toLowerCase())
        : undefined,
    [tags, trimmedQuery]
  );
  const canCreate = Boolean(trimmedQuery) && !exactExisting;

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, renderedOptions.length]);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isOpen]);

  const formatRequiredBy = (tag: Tag) => {
    const sources = impliedSources.get(tag.id) || [];
    return sources.map(s => `#${s.name}`).join(', ');
  };

  const handleSelectTag = (tag: Tag) => {
    if (!effectiveSet.has(tag.id)) {
      onChange(pruneRedundantAncestorTagIds([...selectedTagIds, tag.id], implications));
    }
    setQuery('');
    setError(null);
    setLockHint(null);
    inputRef.current?.focus();
  };

  const handleRemoveTag = (tagId: number) => {
    onChange(selectedTagIds.filter(id => id !== tagId));
    setLockHint(null);
    inputRef.current?.focus();
  };

  const handleCreateMissingTag = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    setError(null);
    setLockHint(null);
    try {
      const created = await api.tags.create({ name: trimmedQuery });
      onTagCreated(created);
      if (!effectiveSet.has(created.id)) {
        onChange(pruneRedundantAncestorTagIds([...selectedTagIds, created.id], implications));
      }
      setQuery('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create Firefly tag');
    } finally {
      setCreating(false);
    }
  };

  const totalChoices = renderedOptions.length + (canCreate ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      setIsOpen(false);
      return;
    }

    if (e.key === 'Backspace' && !query && selectedTagIds.length > 0) {
      e.preventDefault();
      onChange(selectedTagIds.slice(0, -1));
      setLockHint(null);
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
      if (highlightIndex < renderedOptions.length && renderedOptions[highlightIndex]) {
        handleSelectTag(renderedOptions[highlightIndex]);
      } else if (canCreate) {
        handleCreateMissingTag();
      } else if (exactExisting && !effectiveSet.has(exactExisting.id)) {
        handleSelectTag(exactExisting);
      } else if (exactExisting && impliedSources.has(exactExisting.id)) {
        setLockHint(
          `#${exactExisting.name} is already required by ${formatRequiredBy(exactExisting)}.`
        );
      }
    }
  };

  const activeDescendantId =
    isOpen && totalChoices > 0 && highlightIndex < totalChoices
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
            {renderedOptions.length === 0 && !canCreate ? (
              <div className="px-3 py-2 text-xs text-slate-400">
                {tags.length === 0
                  ? 'Type a name to create your first Firefly tag.'
                  : exactExisting && impliedSources.has(exactExisting.id)
                    ? `#${exactExisting.name} is already included via ${formatRequiredBy(exactExisting)}.`
                    : exactExisting && selectedSet.has(exactExisting.id)
                      ? `#${exactExisting.name} is already selected.`
                      : 'No remaining tags match your search.'}
              </div>
            ) : (
              renderedOptions.map((tag, idx) => {
                const { implied } = getEffectiveTagsForIds([tag.id], tags, implications);
                return (
                  <button
                    key={tag.id}
                    id={`${listboxId}-opt-${idx}`}
                    ref={el => {
                      optionRefs.current[idx] = el;
                    }}
                    role="option"
                    aria-selected={idx === highlightIndex}
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
                id={`${listboxId}-opt-${renderedOptions.length}`}
                ref={el => {
                  optionRefs.current[renderedOptions.length] = el;
                }}
                role="option"
                aria-selected={highlightIndex === renderedOptions.length}
                type="button"
                disabled={creating}
                onMouseDown={e => {
                  e.preventDefault();
                  handleCreateMissingTag();
                }}
                className={`w-full text-left px-3 py-2.5 text-xs font-semibold border-t border-slate-100 flex items-center text-blue-600 hover:bg-blue-50 sticky bottom-0 bg-white ${
                  highlightIndex >= renderedOptions.length ? 'bg-blue-50' : ''
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
          updatePosition();
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
              aria-label={`Remove ${tag.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {effectivePreview.implied.map(tag => {
          const requiredBy = formatRequiredBy(tag);
          const hintText = `Required by ${requiredBy} — remove ${requiredBy} first`;
          return (
            <button
              key={`implied-${tag.id}`}
              type="button"
              onClick={e => {
                e.stopPropagation();
                setLockHint(`#${tag.name}: ${hintText}.`);
                inputRef.current?.focus();
              }}
              title={hintText}
              aria-label={`#${tag.name} (${hintText})`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 cursor-not-allowed"
            >
              <Lock className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
              <span>#{tag.name}</span>
            </button>
          );
        })}

        <div className="relative flex-1 min-w-[140px] flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 mr-1.5 shrink-0" />
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
              setQuery(e.target.value);
              setLockHint(null);
              if (!isOpen) setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedTags.length === 0 && effectivePreview.implied.length === 0
                ? placeholder
                : 'Add more tags...'
            }
            autoComplete="off"
            className="w-full py-0.5 text-xs text-slate-800 bg-transparent border-none outline-none focus:ring-0 placeholder:text-slate-400"
          />
        </div>
      </div>

      {lockHint && (
        <p className="text-[11px] text-amber-700 font-medium">{lockHint}</p>
      )}

      {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}

      {dropdownMenu}
    </div>
  );
};
