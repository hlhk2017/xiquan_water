from __future__ import annotations

from datetime import date
from typing import Any

from aiohttp import ClientError, ClientResponseError

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import BASE_URL, DEFAULT_REFERER, MAX_BILLING_HISTORY_YEARS


class XiquanWaterApiError(Exception):
    """Raised when the Xiquan Water API request fails."""


class XiquanWaterApiClient:
    """Small async client for the endpoints used by the original Node-RED flow."""

    def __init__(
        self,
        hass: HomeAssistant,
        card_id: str,
        cookie: str,
        fans_id: str,
        verify: str = "",
        referer: str = DEFAULT_REFERER,
    ) -> None:
        self._session = async_get_clientsession(hass)
        self.card_id = str(card_id).strip()
        self.cookie = str(cookie).strip()
        self.fans_id = str(fans_id).strip()
        self.verify = str(verify).strip()
        self.referer = str(referer or DEFAULT_REFERER).strip()

    @property
    def headers(self) -> dict[str, str]:
        headers = {
            "fansid": self.fans_id,
            "cardId": self.card_id,
            "UserId": self.fans_id,
            "Referer": self.referer,
            "Cookie": self.cookie,
        }
        if self.verify:
            headers["verfiy"] = self.verify
        return headers

    async def async_get_balance(self) -> dict[str, Any]:
        """Fetch balance and yearly water usage data."""

        payload = await self._async_get_json(
            f"{BASE_URL}/api//wap/mx/v1/manager/mxpay/querybalance",
            params={"cardId": self.card_id},
        )
        data = payload.get("data")
        if not isinstance(data, dict):
            raise XiquanWaterApiError("Balance response does not contain data object")
        return data

    async def async_get_billings(
        self, start_bm: str, end_bm: str
    ) -> list[dict[str, Any]]:
        """Fetch billings for a billing month window."""

        payload = await self._async_get_json(
            f"{BASE_URL}/preapi//wap/mcs/v1/card/{self.card_id}/billings",
            params={
                "startBM": start_bm,
                "endBM": end_bm,
                "fansId": self.fans_id,
                "isPayAgentCheck": "0",
            },
        )
        data = payload.get("data")
        if data is None:
            return []
        if not isinstance(data, list):
            raise XiquanWaterApiError("Billing response does not contain data list")
        return [item for item in data if isinstance(item, dict)]

    async def async_get_all_billings(self) -> list[dict[str, Any]]:
        """Fetch all queryable billings by walking yearly windows backwards."""

        today = date.today()
        all_billings: list[dict[str, Any]] = []
        seen_months: set[str] = set()

        for offset in range(MAX_BILLING_HISTORY_YEARS):
            year = today.year - offset
            start_bm = f"{year}01"
            end_month = today.month if year == today.year else 12
            end_bm = f"{year}{end_month:02d}"
            billings = await self.async_get_billings(start_bm, end_bm)

            for bill in billings:
                month = bill.get("billingMonth")
                if month is None:
                    continue
                month_key = str(month).zfill(6)
                if month_key in seen_months:
                    continue
                seen_months.add(month_key)
                all_billings.append(bill)

        return all_billings

    async def async_get_payment_records(self) -> list[dict[str, Any]]:
        """Fetch payment records."""

        payload = await self._async_get_json(
            f"{BASE_URL}/api//wap/mx/v1/manager/mxpayment/queryPaymentDetails",
            params={
                "cardId": self.card_id,
                "fansId": self.fans_id,
                "paymentType": "2",
            },
        )
        data = payload.get("data")
        if data is None:
            return []
        if not isinstance(data, list):
            raise XiquanWaterApiError("Payment records response does not contain data list")
        return [item for item in data if isinstance(item, dict)]

    async def async_validate(self) -> None:
        """Validate credentials by making the lightweight balance request."""

        await self.async_get_balance()

    async def _async_get_json(
        self, url: str, params: dict[str, str] | None = None
    ) -> dict[str, Any]:
        try:
            async with self._session.get(
                url, params=params, headers=self.headers, timeout=20
            ) as response:
                response.raise_for_status()
                payload = await response.json(content_type=None)
        except (ClientError, ClientResponseError, TimeoutError) as err:
            raise XiquanWaterApiError(str(err)) from err
        except ValueError as err:
            raise XiquanWaterApiError("API returned invalid JSON") from err

        if not isinstance(payload, dict):
            raise XiquanWaterApiError("API returned unexpected JSON")
        return payload
