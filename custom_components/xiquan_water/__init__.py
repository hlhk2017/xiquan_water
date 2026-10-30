from __future__ import annotations

import os
from contextlib import suppress

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from .api_client import XiquanWaterApiClient
from .const import (
    CONF_CARD_ID,
    CONF_COOKIE,
    CONF_FANS_ID,
    CONF_REFERER,
    CONF_SCAN_INTERVAL,
    CONF_VERIFY,
    DEFAULT_REFERER,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    LOGGER,
)
from .coordinator import XiquanWaterCoordinator

PLATFORMS: list[Platform] = [Platform.SENSOR]
CARD_FILENAME = "xiquan-water-card.js"
ICON_FILENAME = "icon.png"
CARD_RESOURCE_URL = f"/{DOMAIN}/{CARD_FILENAME}"
ICON_RESOURCE_URL = f"/{DOMAIN}/{ICON_FILENAME}"
CARD_RESOURCE_PREFIXES = (CARD_RESOURCE_URL, f"/local/{CARD_FILENAME}")


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the integration when options change."""

    await hass.config_entries.async_reload(entry.entry_id)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Xiquan Water from a config entry."""

    scan_interval = entry.options.get(
        CONF_SCAN_INTERVAL, entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
    )
    api = XiquanWaterApiClient(
        hass=hass,
        card_id=entry.data[CONF_CARD_ID],
        cookie=entry.data[CONF_COOKIE],
        fans_id=entry.data[CONF_FANS_ID],
        verify=entry.data.get(CONF_VERIFY, ""),
        referer=entry.data.get(CONF_REFERER, DEFAULT_REFERER),
    )
    coordinator = XiquanWaterCoordinator(hass, api, int(scan_interval))

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "api": api,
        "coordinator": coordinator,
    }
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    await coordinator.async_config_entry_first_refresh()
    await async_register_lovelace_resource(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if not hass.data[DOMAIN]:
            hass.data.pop(DOMAIN)
    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload a config entry."""

    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)


async def async_register_lovelace_resource(hass: HomeAssistant) -> None:
    """Register the bundled Xiquan Water Lovelace card."""

    if hass.data.setdefault(DOMAIN, {}).get("card_resource_registered"):
        return

    await async_setup_component(hass, "lovelace", {})
    await async_register_card_static_path(hass)

    version = await hass.async_add_executor_job(_card_resource_version, hass)
    resource_url = f"{CARD_RESOURCE_URL}?v={version}"

    lovelace = hass.data.get("lovelace")
    if lovelace is None:
        LOGGER.warning("Can not access Lovelace data, injecting Xiquan Water card resource only")
        add_extra_js_url(hass, resource_url)
        hass.data[DOMAIN]["card_resource_registered"] = True
        return

    resources = lovelace.resources if hasattr(lovelace, "resources") else lovelace.get("resources")
    if resources is None:
        LOGGER.warning("Can not access Lovelace resources, injecting Xiquan Water card resource only")
        add_extra_js_url(hass, resource_url)
        hass.data[DOMAIN]["card_resource_registered"] = True
        return

    with suppress(Exception):
        if hasattr(resources, "async_get_info"):
            await resources.async_get_info()
        elif not resources.loaded:
            await resources.async_load()

    for item in resources.async_items():
        if not item.get("url", "").startswith(CARD_RESOURCE_PREFIXES):
            continue

        if item["url"] != resource_url and isinstance(resources, ResourceStorageCollection):
            await resources.async_update_item(
                item["id"], {"res_type": "module", "url": resource_url}
            )
            LOGGER.info("Updated Xiquan Water card resource: %s", resource_url)
        hass.data[DOMAIN]["card_resource_registered"] = True
        return

    if isinstance(resources, ResourceStorageCollection):
        await resources.async_create_item({"res_type": "module", "url": resource_url})
        LOGGER.info("Registered Xiquan Water card resource: %s", resource_url)
    else:
        add_extra_js_url(hass, resource_url)
        LOGGER.info("Injected Xiquan Water card resource: %s", resource_url)

    hass.data[DOMAIN]["card_resource_registered"] = True


async def async_register_card_static_path(hass: HomeAssistant) -> None:
    """Expose the bundled frontend card from the integration directory."""

    if hass.data.setdefault(DOMAIN, {}).get("card_static_path_registered"):
        return

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                CARD_RESOURCE_URL,
                hass.config.path("custom_components", DOMAIN, "www", CARD_FILENAME),
                True,
            ),
            StaticPathConfig(
                ICON_RESOURCE_URL,
                hass.config.path("custom_components", DOMAIN, "www", ICON_FILENAME),
                True,
            )
        ]
    )
    hass.data[DOMAIN]["card_static_path_registered"] = True


def _card_resource_version(hass: HomeAssistant) -> str:
    """Return a cache-busting version for the frontend card."""

    card_path = hass.config.path("custom_components", DOMAIN, "www", CARD_FILENAME)
    with suppress(OSError):
        return str(int(os.path.getmtime(card_path)))
    return "1"
