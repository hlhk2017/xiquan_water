from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers.selector import selector

from .api_client import XiquanWaterApiClient, XiquanWaterApiError
from .const import (
    CONF_CARD_ID,
    CONF_COOKIE,
    CONF_FANS_ID,
    CONF_REFERER,
    CONF_SCAN_INTERVAL,
    CONF_SHOW_PAYMENT_RECORDS,
    CONF_VERIFY,
    DEFAULT_REFERER,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    LOGGER,
)


class XiquanWaterConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Xiquan Water."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}
        defaults = {
            CONF_CARD_ID: "",
            CONF_COOKIE: "",
            CONF_FANS_ID: "",
            CONF_VERIFY: "",
            CONF_REFERER: DEFAULT_REFERER,
            CONF_SCAN_INTERVAL: DEFAULT_SCAN_INTERVAL,
        }

        if user_input is not None:
            defaults.update(user_input)
            await self.async_set_unique_id(str(user_input[CONF_CARD_ID]).strip())
            self._abort_if_unique_id_configured()

            api = XiquanWaterApiClient(
                hass=self.hass,
                card_id=user_input[CONF_CARD_ID],
                cookie=user_input[CONF_COOKIE],
                fans_id=user_input[CONF_FANS_ID],
                verify=user_input.get(CONF_VERIFY, ""),
                referer=user_input.get(CONF_REFERER, DEFAULT_REFERER),
            )
            try:
                await api.async_validate()
            except XiquanWaterApiError as err:
                LOGGER.error("硒泉供水连接失败: %s", err)
                errors["base"] = "cannot_connect"
            else:
                card_id = str(user_input[CONF_CARD_ID]).strip()
                return self.async_create_entry(
                    title=f"硒泉供水 {card_id}",
                    data={
                        CONF_CARD_ID: card_id,
                        CONF_COOKIE: str(user_input[CONF_COOKIE]).strip(),
                        CONF_FANS_ID: str(user_input[CONF_FANS_ID]).strip(),
                        CONF_VERIFY: str(user_input.get(CONF_VERIFY, "")).strip(),
                        CONF_REFERER: str(
                            user_input.get(CONF_REFERER, DEFAULT_REFERER)
                        ).strip(),
                        CONF_SCAN_INTERVAL: int(user_input[CONF_SCAN_INTERVAL]),
                    },
                )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(_schema(defaults)),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        return XiquanWaterOptionsFlow(entry)


class XiquanWaterOptionsFlow(config_entries.OptionsFlow):
    """Handle Xiquan Water options."""

    def __init__(self, entry: config_entries.ConfigEntry) -> None:
        self._entry = entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(
                title="",
                data={
                    CONF_SCAN_INTERVAL: int(user_input[CONF_SCAN_INTERVAL]),
                    CONF_SHOW_PAYMENT_RECORDS: bool(user_input.get(CONF_SHOW_PAYMENT_RECORDS, False)),
                },
            )

        scan_interval = self._entry.options.get(
            CONF_SCAN_INTERVAL,
            self._entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        )
        show_payment_records = self._entry.options.get(
            CONF_SHOW_PAYMENT_RECORDS,
            self._entry.data.get(CONF_SHOW_PAYMENT_RECORDS, False),
        )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SCAN_INTERVAL, default=scan_interval
                    ): _scan_interval_selector(),
                    vol.Optional(
                        CONF_SHOW_PAYMENT_RECORDS, default=show_payment_records
                    ): bool,
                }
            ),
        )


def _schema(defaults: dict[str, Any]) -> dict[Any, Any]:
    return {
        vol.Required(CONF_CARD_ID, default=defaults[CONF_CARD_ID]): selector(
            {"text": {"type": "text"}}
        ),
        vol.Required(CONF_COOKIE, default=defaults[CONF_COOKIE]): selector(
            {"text": {"type": "password"}}
        ),
        vol.Required(CONF_FANS_ID, default=defaults[CONF_FANS_ID]): selector(
            {"text": {"type": "text"}}
        ),
        vol.Optional(CONF_VERIFY, default=defaults[CONF_VERIFY]): selector(
            {"text": {"type": "text"}}
        ),
        vol.Optional(CONF_REFERER, default=defaults[CONF_REFERER]): selector(
            {"text": {"type": "text"}}
        ),
        vol.Required(
            CONF_SCAN_INTERVAL, default=defaults[CONF_SCAN_INTERVAL]
        ): _scan_interval_selector(),
    }


def _scan_interval_selector():
    return selector(
        {
            "number": {
                "min": 60,
                "max": 604800,
                "step": 60,
                "unit_of_measurement": "s",
                "mode": "box",
            }
        }
    )
