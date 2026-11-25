from dataclasses import dataclass
from typing import Union


@dataclass(frozen=True)
class VoucherBalanceStatus:
    """Whole-voucher breakdown computed from live Firefly balance in integer cents."""

    usable_vouchers: int
    is_exact_multiple: bool
    remainder_cents: int
    balance_discrepancy: float


def to_cents(amount: Union[float, int, str, None]) -> int:
    """Converts a monetary amount to rounded integer cents without float drift."""
    if amount is None or amount == "":
        return 0
    return round(float(amount) * 100)


def compute_voucher_balance_status(
    balance: Union[float, int, str, None],
    unit_value: Union[float, int, str, None],
) -> VoucherBalanceStatus:
    """
    Computes usable whole vouchers and whether Firefly's live balance is an
    exact multiple of `unit_value`. Negative balances yield 0 usable vouchers
    and report the negative balance as discrepancy.
    """
    balance_cents = to_cents(balance)
    unit_cents = to_cents(unit_value)

    if unit_cents <= 0:
        return VoucherBalanceStatus(
            usable_vouchers=0,
            is_exact_multiple=False,
            remainder_cents=balance_cents,
            balance_discrepancy=round(balance_cents / 100, 2),
        )

    if balance_cents < 0:
        return VoucherBalanceStatus(
            usable_vouchers=0,
            is_exact_multiple=False,
            remainder_cents=balance_cents,
            balance_discrepancy=round(balance_cents / 100, 2),
        )

    usable_vouchers = balance_cents // unit_cents
    remainder_cents = balance_cents % unit_cents
    return VoucherBalanceStatus(
        usable_vouchers=usable_vouchers,
        is_exact_multiple=(remainder_cents == 0),
        remainder_cents=remainder_cents,
        balance_discrepancy=round(remainder_cents / 100, 2),
    )


def max_vouchers_for_total(
    total_amount: Union[float, int, str, None],
    unit_value: Union[float, int, str, None],
    usable_vouchers: int,
) -> int:
    """
    Maximum whole vouchers spendable on a receipt: capped both by
    `floor(total_amount / unit_value)` and `usable_vouchers`.
    """
    total_cents = to_cents(total_amount)
    unit_cents = to_cents(unit_value)
    if total_cents <= 0 or unit_cents <= 0 or usable_vouchers <= 0:
        return 0
    return min(usable_vouchers, total_cents // unit_cents)
