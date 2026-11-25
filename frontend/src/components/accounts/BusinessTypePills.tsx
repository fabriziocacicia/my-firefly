import React from 'react';

interface BusinessTypePillsProps {
  types?: string[];
  inheritedTypes?: string[];
  dense?: boolean;
}

export const BusinessTypePills: React.FC<BusinessTypePillsProps> = ({
  types,
  inheritedTypes,
  dense = false,
}) => {
  if (!types || types.length === 0) return null;

  const paddingClass = dense ? 'px-1.5 py-0.5' : 'px-2 py-0.5 shadow-2xs';
  const roundedClass = dense ? 'rounded' : 'rounded-md';

  return (
    <div className={`flex flex-wrap gap-1 ${dense ? '' : 'pt-0.5'}`}>
      {types.map((type) => {
        const isInherited = inheritedTypes?.includes(type) ?? false;
        return (
          <span
            key={type}
            className={`inline-flex items-center gap-1 ${paddingClass} ${roundedClass} text-[11px] font-semibold border ${
              isInherited
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200/70'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200/80'
            }`}
            title={isInherited ? 'Inherited from parent chain' : 'Local business type'}
          >
            {isInherited && (
              <span className="text-[9px] uppercase tracking-wider text-indigo-500 font-bold">
                Chain:
              </span>
            )}
            {type}
          </span>
        );
      })}
    </div>
  );
};
