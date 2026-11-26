import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface PortalDropdownRect {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'bottom' | 'top';
}

interface UsePortalDropdownOptions {
  isOpen: boolean;
  onClose: () => void;
  minWidth?: number;
  preferredMaxHeight?: number;
  deps?: ReadonlyArray<unknown>;
}

export function usePortalDropdown({
  isOpen,
  onClose,
  minWidth = 220,
  preferredMaxHeight = 280,
  deps = [],
}: UsePortalDropdownOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownRect, setDropdownRect] = useState<PortalDropdownRect | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const updatePosition = useCallback(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const shouldFlip = spaceBelow < 160 && spaceAbove > spaceBelow;
    const availableSpace = Math.max(120, shouldFlip ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(preferredMaxHeight, availableSpace);
    const top = shouldFlip
      ? Math.max(8, rect.top - maxHeight - 4)
      : rect.bottom + 4;

    setDropdownRect({
      top,
      left: rect.left,
      width: Math.max(rect.width, minWidth),
      maxHeight,
      placement: shouldFlip ? 'top' : 'bottom',
    });
  }, [minWidth, preferredMaxHeight]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, updatePosition, ...deps]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inContainer = containerRef.current?.contains(target) ?? false;
      const inDropdown = dropdownRef.current?.contains(target) ?? false;
      if (!inContainer && !inDropdown) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return {
    containerRef,
    dropdownRef,
    dropdownRect,
    updatePosition,
  };
}
