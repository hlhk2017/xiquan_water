from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfVolume
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, UNIT_YUAN, VERSION
from .coordinator import XiquanWaterCoordinator

SENSOR_TYPES: list[dict[str, Any]] = [
    {
        "key": "balance",
        "name": "水费余额",
        "native_unit_of_measurement": UNIT_YUAN,
        "device_class": SensorDeviceClass.MONETARY,
        "state_class": SensorStateClass.MEASUREMENT,
    },
    {
        "key": "annual_usage",
        "name": "年度用水",
        "native_unit_of_measurement": UnitOfVolume.CUBIC_METERS,
        "device_class": SensorDeviceClass.WATER,
        "state_class": SensorStateClass.TOTAL_INCREASING,
    },
    {
        "key": "latest_bill",
        "name": "上月水费",
        "native_unit_of_measurement": UNIT_YUAN,
        "device_class": SensorDeviceClass.MONETARY,
        "state_class": SensorStateClass.MEASUREMENT,
    },
    {
        "key": "latest_payment",
        "name": "最近充值",
        "native_unit_of_measurement": UNIT_YUAN,
        "device_class": SensorDeviceClass.MONETARY,
        "state_class": SensorStateClass.MEASUREMENT,
    },
]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Xiquan Water sensors."""

    data = hass.data[DOMAIN][entry.entry_id]
    coordinator: XiquanWaterCoordinator = data["coordinator"]
    async_add_entities(
        [XiquanWaterSensor(coordinator, sensor_type, entry.entry_id) for sensor_type in SENSOR_TYPES]
    )


class XiquanWaterSensor(CoordinatorEntity[XiquanWaterCoordinator], SensorEntity):
    """Xiquan Water sensor entity."""

    _attr_has_entity_name = True
    _unrecorded_attributes = frozenset({"monthList", "yearly_billings", "raw_balance"})

    def __init__(
        self,
        coordinator: XiquanWaterCoordinator,
        sensor_type: dict[str, Any],
        entry_id: str,
    ) -> None:
        super().__init__(coordinator)
        self._sensor_type = sensor_type
        self._attr_name = sensor_type["name"]
        self._attr_unique_id = f"{entry_id}-{coordinator.api.card_id}-{sensor_type['key']}"

        if "device_class" in sensor_type:
            self._attr_device_class = sensor_type["device_class"]
        if "state_class" in sensor_type:
            self._attr_state_class = sensor_type["state_class"]
        if "native_unit_of_measurement" in sensor_type:
            self._attr_native_unit_of_measurement = sensor_type[
                "native_unit_of_measurement"
            ]
        if "icon" in sensor_type:
            self._attr_icon = sensor_type["icon"]

        self._attr_device_info = {
            "identifiers": {(DOMAIN, coordinator.api.card_id)},
            "name": f"水表 {coordinator.api.card_id}",
            "manufacturer": "硒泉供水",
            "model": "智能水表",
            "sw_version": VERSION,
        }

    @property
    def native_value(self) -> Any:
        return (self.coordinator.data or {}).get(self._sensor_type["key"])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data or {}
        if self._sensor_type["key"] == "latest_bill":
            return {
                "最新月份": data.get("latest_bill_month"),
                "使用详情": data.get("latest_bill_detail"),
                "yearly_billings": data.get("yearly_billings"),
                "monthList": data.get("month_list"),
                "最后更新": data.get("last_update"),
            }
        if self._sensor_type["key"] == "balance":
            return {"raw_balance": data.get("raw_balance")}
        if self._sensor_type["key"] == "latest_payment":
            return {"充值记录": data.get("payment_records")}
        return {}
