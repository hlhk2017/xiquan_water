from __future__ import annotations

import logging

DOMAIN = "xiquan_water"
PACKAGE_NAME = "custom_components.xiquan_water"
VERSION = "0.1.0"

LOGGER = logging.getLogger(PACKAGE_NAME)

BASE_URL = "http://www.xiquanwater.com"
DEFAULT_REFERER = "http://www.xiquanwater.com/?v=1210"
DEFAULT_SCAN_INTERVAL = 259200
MAX_BILLING_HISTORY_YEARS = 20

CONF_CARD_ID = "card_id"
CONF_COOKIE = "cookie"
CONF_FANS_ID = "fans_id"
CONF_VERIFY = "verify"
CONF_REFERER = "referer"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_SHOW_PAYMENT_RECORDS = "show_payment_records"

UNIT_YUAN = "元"
