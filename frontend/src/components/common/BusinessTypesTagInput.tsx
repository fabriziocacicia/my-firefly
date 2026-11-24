import React, { useState, KeyboardEvent } from 'react';
import { Tag as TagIcon, X, Plus } from 'lucide-react';
import { COMMON_BUSINESS_TYPES } from '../../types';

interface BusinessTypesTagInputProps {
  value: string[];
  onChange: (types: string[]) => void;
  inheritedTypes?: string[];
  placeholder?: string;
  allAvailableTypes?: string[];
}

export const BusinessTypesTagInput: React.FC<BusinessTypesTagInputProps> = ({
  value = [],
  onChange,
  inheritedTypes = [],
  placeholder = 'Add business type (e.g. Bar/Cafe, Tobacconist)...',
  allAvailableTypes = [],
}) => {
  const [inputVal, setInputVal] = useState('');

  const handleAdd = (typeToAdd: string) => {
    const clean = typeToAdd.trim();
    if (!clean) return;
    if (!value.includes(clean) && !inheritedTypes.includes(clean)) {
      onChange([...value, clean]);
    }
    setInputVal('');
  };

  const handleRemove = (typeToRemove: string) => {
    onChange(value.filter((t) => t !== typeToRemove));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd(inputVal);
    }
  };

  // Merge common business types + any other types already used
  const combinedSuggestions = Array.from(
    new Set([...COMMON_BUSINESS_TYPES, ...allAvailableTypes])
  ).filter((t) => !value.includes(t) && !inheritedTypes.includes(t));

  const filteredSuggestions = inputVal.trim()
    ? combinedSuggestions.filter((t) =>
        t.toLowerCase().includes(inputVal.trim().toLowerCase())
      )
    : combinedSuggestions.slice(0, 10);

  return (
    <div className="space-y-2">
      {/* Tags Container */}
      <div className="p-2 border border-slate-300 rounded-xl bg-white focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-500 transition min-h-[46px] flex flex-wrap items-center gap-1.5">
        {/* Inherited Types (Read-only) */}
        {inheritedTypes.map((t) => (
          <span
            key={`inherited-${t}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/70 shadow-2xs"
            title="Inherited from parent retail chain"
          >
            <span className="text-[10px] uppercase tracking-wider text-indigo-500 font-bold">Chain:</span>
            {t}
          </span>
        ))}

        {/* Selected Local Types */}
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shadow-2xs animate-in fade-in"
          >
            <TagIcon className="w-3 h-3 text-emerald-600" />
            <span>{t}</span>
            <button
              type="button"
              onClick={() => handleRemove(t)}
              className="text-emerald-600 hover:text-emerald-950 p-0.5 rounded-full hover:bg-emerald-200/60 transition"
              title={`Remove ${t}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {/* Text Input */}
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 && inheritedTypes.length === 0 ? placeholder : 'Add more...'}
          className="flex-1 min-w-[140px] px-2 py-1 text-xs text-slate-800 bg-transparent border-none outline-none focus:ring-0 placeholder:text-slate-400"
        />
      </div>

      {/* Quick Add Suggestions Pills */}
      {filteredSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-slate-400 font-medium mr-0.5">Quick add:</span>
          {filteredSuggestions.slice(0, 8).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleAdd(t)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 border border-slate-200/80 transition cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>{t}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
