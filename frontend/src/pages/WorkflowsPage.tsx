import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FireflyAssetAccount } from '../types';
import { Ticket, Users, Send, CheckCircle2, Calculator } from 'lucide-react';
import { StoreCombobox } from '../components/common/StoreCombobox';

export const WorkflowsPage: React.FC = () => {
  const [assetAccounts, setAssetAccounts] = useState<FireflyAssetAccount[]>([]);

  // Buoni Pasto State
  const [destAccountId, setDestAccountId] = useState<number | ''>('');
  const [destAccountName, setDestAccountName] = useState<string>('');
  const [ticketAccountId, setTicketAccountId] = useState<number | ''>('');
  const [cardAccountId, setCardAccountId] = useState<number | ''>('');
  const [totalAmount, setTotalAmount] = useState('15.00');
  const [ticketCount, setTicketCount] = useState('1');
  const [ticketValue, setTicketValue] = useState('5.16');
  const [voucherSubmitting, setVoucherSubmitting] = useState(false);
  const [voucherSuccess, setVoucherSuccess] = useState<string | null>(null);

  // Family Subscription State
  const [subServiceName, setSubServiceName] = useState('Spotify Family');
  const [subMonthLabel, setSubMonthLabel] = useState(() => {
    const d = new Date();
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  });
  const [subAmount, setSubAmount] = useState('17.99');
  const [subSourceAccountId, setSubSourceAccountId] = useState<number | ''>('');
  const [subExpenseAccountId, setSubExpenseAccountId] = useState<number | ''>('');
  const [subExpenseAccountName, setSubExpenseAccountName] = useState<string>('');
  const [subSubmitting, setSubSubmitting] = useState(false);
  const [subSuccess, setSubSuccess] = useState<string | null>(null);

  useEffect(() => {
    api.firefly.getAssetAccounts()
      .then(ass => {
        setAssetAccounts(ass);
        if (ass.length > 0) {
          setTicketAccountId(ass[0].id);
          setCardAccountId(ass[ass.length > 1 ? 1 : 0].id);
          setSubSourceAccountId(ass[0].id);
        }
      })
      .catch(err => {
        console.error(err);
      });
  }, []);

  // Compute live breakdown for Buoni Pasto
  const numericTotal = parseFloat(totalAmount) || 0;
  const count = parseInt(ticketCount) || 0;
  const singleValue = parseFloat(ticketValue) || 5.16;
  const calculatedTicketTotal = Math.min(numericTotal, Math.round(count * singleValue * 100) / 100);
  const calculatedCardRemainder = Math.max(0, Math.round((numericTotal - calculatedTicketTotal) * 100) / 100);

  const handleExecuteMealVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destAccountId || !ticketAccountId || !cardAccountId || numericTotal <= 0) return;

    setVoucherSubmitting(true);
    setVoucherSuccess(null);
    try {
      const res = await api.workflows.mealVoucherSplit({
        purchase_date: new Date().toISOString().split('T')[0],
        destination_account_id: Number(destAccountId),
        destination_account_name: destAccountName || 'Supermarket',
        ticket_account_id: Number(ticketAccountId),
        ticket_count: count,
        ticket_unit_value: singleValue,
        card_account_id: Number(cardAccountId),
        total_amount: numericTotal,
        description: `Grocery Shopping at ${destAccountName || 'Supermarket'}`
      });
      setVoucherSuccess(`Successfully created 2 split transactions in Firefly! (Vouchers: €${res.ticket_amount.toFixed(2)}, Card: €${res.card_remainder.toFixed(2)})`);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setVoucherSubmitting(false);
    }
  };

  const handleExecuteFamilyPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subSourceAccountId || !subExpenseAccountId || parseFloat(subAmount) <= 0) return;

    setSubSubmitting(true);
    setSubSuccess(null);
    try {
      const res = await api.workflows.familyPlan({
        purchase_date: new Date().toISOString().split('T')[0],
        service_name: subServiceName,
        month_label: subMonthLabel,
        source_account_id: Number(subSourceAccountId),
        expense_account_id: Number(subExpenseAccountId),
        total_amount: parseFloat(subAmount)
      });
      setSubSuccess(`Created transaction: "${res.description}" for €${parseFloat(subAmount).toFixed(2)} in Firefly!`);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSubSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="pb-6 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Quick Workflows & Automation</h1>
        <p className="text-sm text-slate-500 mt-1">
          Eliminate repetitive financial math: automatically balance meal vouchers with card remainders, and generate recurring family splits with 1-click.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* WORKFLOW 1: BUONI PASTO SPLITTER */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-100">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700">
                <Ticket className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Buoni Pasto / Split Payment Wizard</h2>
                <p className="text-xs text-slate-500">Auto-balances voucher limit + card remainder into 2 Firefly transactions</p>
              </div>
            </div>

            {voucherSuccess && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{voucherSuccess}</span>
              </div>
            )}

            <form onSubmit={handleExecuteMealVoucher} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Supermarket / Expense Account</label>
                <StoreCombobox
                  value={destAccountId ? Number(destAccountId) : null}
                  accountNameHint={destAccountName}
                  onChange={(id, name) => {
                    setDestAccountId(id ?? '');
                    setDestAccountName(name);
                  }}
                  placeholder="Search store / expense account..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Total Cart Amount (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={totalAmount}
                    onChange={e => setTotalAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Voucher Value (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={ticketValue}
                    onChange={e => setTicketValue(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ticket Count (Quantity)</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={ticketCount}
                    onChange={e => setTicketCount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ticket Asset Account</label>
                  <select
                    value={ticketAccountId}
                    onChange={e => setTicketAccountId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {assetAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Remaining Balance Card / Cash Account</label>
                <select
                  value={cardAccountId}
                  onChange={e => setCardAccountId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  {assetAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              {/* Live Calculation Preview */}
              <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200/80 text-xs">
                <span className="font-semibold text-amber-900 block mb-1.5 flex items-center">
                  <Calculator className="w-3.5 h-3.5 mr-1" /> Firefly Split Preview
                </span>
                <div className="flex justify-between py-0.5 text-slate-700">
                  <span>1. Ticket Account Withdrawal:</span>
                  <strong>€{calculatedTicketTotal.toFixed(2)}</strong>
                </div>
                <div className="flex justify-between py-0.5 text-slate-700">
                  <span>2. Card Account Remainder:</span>
                  <strong>€{calculatedCardRemainder.toFixed(2)}</strong>
                </div>
                <div className="mt-1 pt-1 border-t border-amber-200/60 flex justify-between font-bold text-slate-900">
                  <span>Total Balanced:</span>
                  <span>€{numericTotal.toFixed(2)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={voucherSubmitting || !destAccountId}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center space-x-1.5"
              >
                <Send className="w-4 h-4" />
                <span>{voucherSubmitting ? 'Posting to Firefly...' : 'Create Both Transactions in Firefly'}</span>
              </button>
            </form>
          </div>
        </div>

        {/* WORKFLOW 2: RECURRING FAMILY PLAN SUBSCRIPTION */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center space-x-3 pb-4 border-b border-slate-100">
              <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-700">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Family Subscription Replicator</h2>
                <p className="text-xs text-slate-500">1-click create monthly Spotify, iCloud, or Netflix shared bills</p>
              </div>
            </div>

            {subSuccess && (
              <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{subSuccess}</span>
              </div>
            )}

            <form onSubmit={handleExecuteFamilyPlan} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Service Preset</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Spotify Family', 'iCloud 2TB', 'Netflix Premium'].map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSubServiceName(s)}
                      className={`py-2 px-2 text-xs font-medium rounded-lg border transition ${
                        subServiceName === s
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-semibold'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Billing Month</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    required
                    value={subMonthLabel}
                    onChange={e => setSubMonthLabel(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      setSubMonthLabel(d.toLocaleString('en-US', { month: 'long', year: 'numeric' }));
                    }}
                    className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200"
                  >
                    Current
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Total Amount (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={subAmount}
                    onChange={e => setSubAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Source Account (Card)</label>
                  <select
                    value={subSourceAccountId}
                    onChange={e => setSubSourceAccountId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {assetAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Expense Account (Destination)</label>
                <StoreCombobox
                  value={subExpenseAccountId ? Number(subExpenseAccountId) : null}
                  accountNameHint={subExpenseAccountName}
                  onChange={(id, name) => {
                    setSubExpenseAccountId(id ?? '');
                    setSubExpenseAccountName(name);
                  }}
                  placeholder="Search expense account..."
                />
              </div>

              <button
                type="submit"
                disabled={subSubmitting || !subExpenseAccountId}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center space-x-1.5"
              >
                <Send className="w-4 h-4" />
                <span>{subSubmitting ? 'Posting...' : `Post "${subServiceName} - ${subMonthLabel}"`}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
