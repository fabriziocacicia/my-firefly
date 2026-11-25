import {
  Building2,
  Globe,
  HelpCircle,
  LucideIcon,
  Store,
  User,
  Zap,
} from 'lucide-react';
import { AccountRole } from '../../types';

export type EffectiveAccountRole =
  | 'chain'
  | 'local_business'
  | 'ecommerce'
  | 'service'
  | 'person'
  | 'unclassified';

export type AccountFilter =
  | 'all'
  | 'chains'
  | 'local_business'
  | 'ecommerce'
  | 'service'
  | 'person'
  | 'unclassified';

export interface RoleMeta {
  label: string;
  tableLabel: string;
  description: string;
  icon: LucideIcon;
  cardBorderClass: string;
  iconWrapperClass: string;
  tableBadgeClass: string;
  cardCategoryBadgeClass: string;
  tableCategoryBadgeClass: string;
  cardHeaderTextClass: string;
  cardHeaderIconClass: string;
  modalTileActiveClass: string;
  modalIconActiveClass: string;
}

/**
 * Normalize legacy roles (`physical_store`, `independent`) to `local_business`,
 * falling back to `chain` when a `companyId` is linked or `unclassified` otherwise.
 */
export function normalizeRole(
  role?: AccountRole,
  companyId?: number | null
): EffectiveAccountRole {
  if (role === 'physical_store' || role === 'independent') return 'local_business';
  if (role) return role;
  return companyId ? 'chain' : 'unclassified';
}

export const ROLE_ORDER: EffectiveAccountRole[] = [
  'chain',
  'local_business',
  'ecommerce',
  'service',
  'person',
  'unclassified',
];

export const ROLE_META: Record<EffectiveAccountRole, RoleMeta> = {
  chain: {
    label: 'Chain Branch',
    tableLabel: 'Chain Branch',
    description: "Inherits chain's types",
    icon: Building2,
    cardBorderClass: 'border-indigo-100/80 hover:border-indigo-200',
    iconWrapperClass: 'bg-indigo-50 text-indigo-600',
    tableBadgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200/60',
    cardCategoryBadgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200/60',
    tableCategoryBadgeClass: 'bg-indigo-50 text-indigo-700',
    cardHeaderTextClass: 'text-indigo-700',
    cardHeaderIconClass: 'text-indigo-500',
    modalTileActiveClass:
      'border-indigo-600 bg-indigo-50/40 text-indigo-900 ring-2 ring-indigo-500/20',
    modalIconActiveClass: 'text-indigo-600',
  },
  local_business: {
    label: 'Local Business',
    tableLabel: 'Local Business',
    description: 'Physical shop, bar, gym, etc.',
    icon: Store,
    cardBorderClass: 'border-emerald-100/80 hover:border-emerald-200',
    iconWrapperClass: 'bg-emerald-50 text-emerald-600',
    tableBadgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
    cardCategoryBadgeClass:
      'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
    tableCategoryBadgeClass: 'bg-emerald-50 text-emerald-700',
    cardHeaderTextClass: 'text-emerald-700',
    cardHeaderIconClass: 'text-emerald-500',
    modalTileActiveClass:
      'border-emerald-600 bg-emerald-50/40 text-emerald-900 ring-2 ring-emerald-500/20',
    modalIconActiveClass: 'text-emerald-600',
  },
  ecommerce: {
    label: 'E-Commerce',
    tableLabel: 'E-Commerce',
    description: 'Online store / web shop',
    icon: Globe,
    cardBorderClass: 'border-sky-100/80 hover:border-sky-200',
    iconWrapperClass: 'bg-sky-50 text-sky-600',
    tableBadgeClass: 'bg-sky-50 text-sky-700 border border-sky-200/60',
    cardCategoryBadgeClass: 'bg-sky-100 text-sky-800',
    tableCategoryBadgeClass: 'bg-sky-50 text-sky-700',
    cardHeaderTextClass: 'text-sky-700',
    cardHeaderIconClass: 'text-sky-500',
    modalTileActiveClass:
      'border-sky-600 bg-sky-50/40 text-sky-900 ring-2 ring-sky-500/20',
    modalIconActiveClass: 'text-sky-600',
  },
  service: {
    label: 'Service / Utility',
    tableLabel: 'Service',
    description: 'Subscription, utility, bills',
    icon: Zap,
    cardBorderClass: 'border-purple-100/80 hover:border-purple-200',
    iconWrapperClass: 'bg-purple-50 text-purple-600',
    tableBadgeClass: 'bg-purple-50 text-purple-700 border border-purple-200/60',
    cardCategoryBadgeClass: 'bg-purple-100 text-purple-800',
    tableCategoryBadgeClass: 'bg-purple-50 text-purple-700',
    cardHeaderTextClass: 'text-purple-700',
    cardHeaderIconClass: 'text-purple-500',
    modalTileActiveClass:
      'border-purple-600 bg-purple-50/40 text-purple-900 ring-2 ring-purple-500/20',
    modalIconActiveClass: 'text-purple-600',
  },
  person: {
    label: 'Person',
    tableLabel: 'Person',
    description: 'Individual peer',
    icon: User,
    cardBorderClass: 'border-slate-200 hover:border-slate-300',
    iconWrapperClass: 'bg-slate-100 text-slate-600',
    tableBadgeClass: 'bg-slate-100 text-slate-700 border border-slate-200',
    cardCategoryBadgeClass: 'bg-slate-100 text-slate-700',
    tableCategoryBadgeClass: 'bg-slate-100 text-slate-700',
    cardHeaderTextClass: 'text-slate-500',
    cardHeaderIconClass: 'text-slate-400',
    modalTileActiveClass:
      'border-slate-600 bg-slate-100 text-slate-900 ring-2 ring-slate-400/20',
    modalIconActiveClass: 'text-slate-700',
  },
  unclassified: {
    label: 'Unclassified',
    tableLabel: 'Unclassified',
    description: 'Standard account',
    icon: HelpCircle,
    cardBorderClass: 'border-slate-200 hover:border-slate-300',
    iconWrapperClass: 'bg-slate-100 text-slate-400',
    tableBadgeClass: '',
    cardCategoryBadgeClass: '',
    tableCategoryBadgeClass: '',
    cardHeaderTextClass: 'text-slate-500',
    cardHeaderIconClass: 'text-slate-400',
    modalTileActiveClass:
      'border-amber-600 bg-amber-50/40 text-amber-900 ring-2 ring-amber-500/20',
    modalIconActiveClass: 'text-amber-600',
  },
};
