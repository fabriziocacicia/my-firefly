import statistics
from typing import Optional


def normalize_unit_price(
    price: float,
    quantity: float = 1.0,
    unit: str = "pcs",
    package_size: float = 1.0
) -> Optional[float]:
    """
    Computes normalized unit price:
    - Weight (g, kg) -> € / kg
    - Volume (ml, l) -> € / L
    - Pieces (pcs, unit) -> € / piece
    """
    total_units = quantity * (package_size if package_size > 0 else 1.0)
    if total_units <= 0 or price <= 0:
        return None

    unit_clean = unit.lower().strip()

    if unit_clean in ["g", "gr", "gram", "grams"]:
        # price / (total_units / 1000 kg)
        return round(price / (total_units / 1000.0), 3)
    elif unit_clean in ["kg", "kilo", "kilogram"]:
        return round(price / total_units, 3)
    elif unit_clean in ["ml", "milliliter"]:
        # price / (total_units / 1000 L)
        return round(price / (total_units / 1000.0), 3)
    elif unit_clean in ["l", "lt", "liter", "liters"]:
        return round(price / total_units, 3)
    else:
        # pcs, packs, items
        return round(price / total_units, 3)


def compute_deal_analysis(
    current_price: float,
    regular_price: float,
    history_prices: list[float],
    history_regular_prices: list[float],
    normalized_current_price: Optional[float] = None,
    normalized_prices: Optional[list[float]] = None,
    normalized_regular_prices: Optional[list[float]] = None,
) -> dict:
    """
    Evaluates whether the price is a good deal compared to history, using median
    historical regular price as the baseline and including normalized metrics when provided.
    """
    discount_pct = 0.0
    if regular_price > 0 and current_price < regular_price:
        discount_pct = round(((regular_price - current_price) / regular_price) * 100, 1)

    all_time_low = min(history_prices) if history_prices else current_price

    # Baseline is median of historical regular prices
    baseline = statistics.median(history_regular_prices) if history_regular_prices else regular_price

    deal_rating = "REGULAR"
    if current_price <= all_time_low and current_price < baseline:
        deal_rating = "ALL_TIME_LOW"
    elif baseline > 0 and (baseline - current_price) / baseline >= 0.20:
        deal_rating = "GREAT_DEAL"
    elif baseline > 0 and (baseline - current_price) / baseline >= 0.10:
        deal_rating = "GOOD_DEAL"

    norm_all_time_low = (
        min(normalized_prices) if normalized_prices else normalized_current_price
    )
    norm_baseline = (
        round(statistics.median(normalized_regular_prices), 3)
        if normalized_regular_prices
        else None
    )

    return {
        "current_price": current_price,
        "regular_price": regular_price,
        "discount_pct": discount_pct,
        "all_time_low": all_time_low,
        "baseline_regular_price": baseline,
        "deal_rating": deal_rating,
        "normalized_current_price": normalized_current_price,
        "normalized_all_time_low": norm_all_time_low,
        "normalized_baseline_regular_price": norm_baseline,
    }
