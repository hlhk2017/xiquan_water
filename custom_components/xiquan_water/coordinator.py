from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api_client import XiquanWaterApiClient, XiquanWaterApiError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN, LOGGER


class XiquanWaterCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinate periodic updates from Xiquan Water."""

    def __init__(
        self,
        hass: HomeAssistant,
        api: XiquanWaterApiClient,
        scan_interval: int = DEFAULT_SCAN_INTERVAL,
    ) -> None:
        self.api = api
        super().__init__(
            hass,
            logger=LOGGER,
            name="硒泉供水数据",
            update_interval=timedelta(seconds=max(scan_interval, 60)),
        )

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            balance = await self.api.async_get_balance()
            billings = await self.api.async_get_all_billings()
            payment_records = await self.api.async_get_payment_records()
            return _normalize_data(balance, billings, payment_records)
        except XiquanWaterApiError as err:
            raise UpdateFailed(str(err)) from err


def _normalize_data(
    balance: dict[str, Any], billings: list[dict[str, Any]], payment_records: list[dict[str, Any]]
) -> dict[str, Any]:
    valid_bills = [
        {**bill, "billingMonth": str(bill.get("billingMonth")).zfill(6)}
        for bill in billings
        if bill.get("billingMonth") is not None
    ]
    valid_bills.sort(key=lambda bill: bill["billingMonth"], reverse=True)
    latest = valid_bills[0] if valid_bills else None

    return {
        "balance": balance.get("balance"),
        "annual_usage": _sum_year_usage(valid_bills, date.today().year),
        "latest_bill": latest.get("checkMoney") if latest else None,
        "latest_bill_month": latest.get("billingMonth") if latest else None,
        "latest_bill_detail": _bill_detail(latest) if latest else {},
        "month_list": [_month_summary(bill) for bill in valid_bills],
        "yearly_billings": _yearly_billings(valid_bills),
        "last_update": dt_util.now().isoformat(),
        "raw_balance": balance,
        "payment_records": _normalize_payment_records(payment_records),
        "latest_payment": _latest_payment(payment_records),
    }


def _latest_payment(records: list[dict[str, Any]]) -> float | None:
    """Get the most recent payment amount."""
    if not records:
        return None
    sorted_records = sorted(records, key=lambda x: x.get("createTime", ""), reverse=True)
    latest = sorted_records[0] if sorted_records else None
    return latest.get("money") if latest else None


def _normalize_payment_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize payment records for display."""
    normalized = []
    for record in records:
        create_time = record.get("createTime", "")
        if isinstance(create_time, str) and "T" in create_time:
            date_part = create_time.split("T", 1)[0]
        else:
            date_part = create_time
        normalized.append({
            "paymentType": record.get("paymentType"),
            "createTime": create_time,
            "date": date_part,
            "money": record.get("money"),
        })
    normalized.sort(key=lambda x: x.get("createTime", ""), reverse=True)
    return normalized


def _bill_detail(bill: dict[str, Any]) -> dict[str, Any]:
    return {
        "上次读数": bill.get("lastReading"),
        "当前读数": bill.get("reading"),
        "月累计": bill.get("readWater"),
    }


def _month_summary(bill: dict[str, Any]) -> dict[str, Any]:
    read_date = bill.get("readDate")
    if isinstance(read_date, str) and "T" in read_date:
        read_date = read_date.split("T", 1)[0]
    return {
        "month": bill.get("billingMonth"),
        "amount": bill.get("checkMoney"),
        "usage": bill.get("readWater"),
        "endDate": read_date,
        "lastReading": bill.get("lastReading"),
        "reading": bill.get("reading"),
    }


def _sum_year_usage(bills: list[dict[str, Any]], year: int) -> float:
    total = 0.0
    prefix = str(year)
    for bill in bills:
        if not str(bill.get("billingMonth", "")).startswith(prefix):
            continue
        try:
            total += float(bill.get("readWater") or 0)
        except (TypeError, ValueError):
            continue
    return round(total, 2)


def _yearly_billings(bills: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    yearly: dict[str, list[dict[str, Any]]] = {}
    for bill in bills:
        month = str(bill.get("billingMonth", "")).zfill(6)
        if len(month) < 4:
            continue
        yearly.setdefault(month[:4], []).append(_month_summary(bill))
    return yearly
