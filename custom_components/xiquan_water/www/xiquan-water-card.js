const DOMAIN = "xiquan_water";
const CARD_TYPE = "xiquan-water-card";

const SENSOR_KEYS = {
  balance: { label: "水费余额", icon: "mdi:cash", unit: "元" },
  annual_usage: { label: "年度用水", icon: "mdi:water", unit: "m³" },
  latest_bill: { label: "最新账单", icon: "mdi:receipt-text-outline", unit: "元" },
  latest_payment: { label: "最近充值", icon: "mdi:credit-card-outline" },
};

const AMOUNT_COLOR = "#1f8a70";
const USAGE_COLOR = "#2f80ed";
const WATER_ACCENT = "#2f80ed";
const TABS = {
  chart: "账单趋势",
  calendar: "月历账单",
  payment: "充值记录",
};

function isXiquanDevice(device) {
  const identifiers = device?.identifiers || [];
  const text = [
    device?.name_by_user,
    device?.name,
    device?.manufacturer,
    device?.model,
  ].filter(Boolean).join(" ");
  return identifiers.some((identifier) => identifier?.[0] === DOMAIN)
    || /硒泉|xiquan/i.test(text);
}

function keyFromEntry(entry) {
  if (!entry?.unique_id) return null;
  const key = entry.unique_id.split("-").pop();
  return SENSOR_KEYS[key] ? key : null;
}

class XiquanWaterCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("xiquan-water-card-editor");
  }

  static getStubConfig() {
    return {
      type: `custom:${CARD_TYPE}`,
      title: "硒泉供水",
      show_calendar: true,
      show_payment_records: true,
    };
  }

  setConfig(config) {
    const previousDevice = this.config?.device_id;
    this.config = {
      title: "硒泉供水",
      show_calendar: true,
      show_payment_records: true,
      ...config,
    };
    if (this.config.device_id === "") delete this.config.device_id;
    if (previousDevice !== this.config.device_id) {
      this.device = null;
      this.entities = {};
      this.registryEntries = [];
      this.discoveryKey = "";
    }
    this.render();
  }

  connectedCallback() {
    this.ensureHandlers();
  }

  disconnectedCallback() {
    if (!this.shadowRoot) return;
    if (this._clickHandler) this.shadowRoot.removeEventListener("click", this._clickHandler);
    if (this._moveHandler) {
      this.shadowRoot.removeEventListener("pointermove", this._moveHandler);
      this.shadowRoot.removeEventListener("touchstart", this._moveHandler);
      this.shadowRoot.removeEventListener("touchmove", this._moveHandler);
    }
    if (this._leaveHandler) this.shadowRoot.removeEventListener("pointerleave", this._leaveHandler);
    this._clickHandler = null;
    this._moveHandler = null;
    this._leaveHandler = null;
  }

  activeTab() {
    if (this._activeTab && Object.keys(TABS).includes(this._activeTab)) {
      return this._activeTab;
    }
    return "chart";
  }

  set hass(hass) {
    this._hass = hass;
    this.discoverEntities();
    this.render();
  }

  getCardSize() {
    return this.config?.show_calendar === false ? 4 : 7;
  }

  async discoverEntities() {
    if (!this._hass?.callWS || this.discovering) return;
    const key = JSON.stringify({
      device_id: this.config?.device_id,
      states: Object.keys(this._hass.states || {}).length,
    });
    if (this.discoveryKey === key && Object.keys(this.entities || {}).length) return;

    this.discovering = true;
    try {
      const [devices, registry] = await Promise.all([
        this._hass.callWS({ type: "config/device_registry/list" }),
        this._hass.callWS({ type: "config/entity_registry/list" }),
      ]);
      const waterDevices = devices.filter((device) => isXiquanDevice(device));
      const selected = this.config?.device_id
        ? waterDevices.find((device) => device.id === this.config.device_id)
        : this.findBestDevice(waterDevices, registry);

      this.device = selected || null;
      this.registryEntries = selected
        ? registry.filter((entry) => entry.device_id === selected.id)
        : [];
      this.entities = this.mapEntities(this.registryEntries);
      this.discoveryError = null;
      this.discoveryKey = key;
    } catch (error) {
      this.discoveryError = error;
    } finally {
      this.discovering = false;
      this.render(true);
    }
  }

  findBestDevice(devices, registry) {
    return devices
      .map((device) => ({
        device,
        count: registry.filter((entry) =>
          entry.device_id === device.id && entry.entity_id?.startsWith("sensor.")
        ).length,
      }))
      .sort((a, b) => b.count - a.count)[0]?.device || devices[0] || null;
  }

  mapEntities(entries) {
    const result = {};
    entries
      .filter((entry) => !entry.disabled_by && !entry.hidden_by)
      .forEach((entry) => {
        const key = keyFromEntry(entry);
        if (key && this._hass.states[entry.entity_id]) result[key] = entry.entity_id;
      });
    return result;
  }

  entity(key) {
    return this.entities?.[key];
  }

  state(key) {
    const entityId = this.entity(key);
    return entityId ? this._hass?.states?.[entityId] : null;
  }

  billEntity() {
    return this.state("latest_bill");
  }

  paymentRecordsEntity() {
    return this.state("latest_payment");
  }

  paymentRows() {
    const attrs = this.paymentRecordsEntity()?.attributes || {};
    const records = attrs.充值记录 || [];
    const result = Array.isArray(records) ? records : [];
    return result.map((row) => {
      let date = row.date;
      if (!date && row.createTime) {
        const time = String(row.createTime);
        if (time.includes("T")) {
          date = time.split("T")[0];
        } else {
          date = time;
        }
      }
      return { ...row, date };
    });
  }

  billRows() {
    const attrs = this.billEntity()?.attributes || {};
    const yearly = attrs.yearly_billings;
    const rows = [];
    if (yearly && typeof yearly === "object" && !Array.isArray(yearly)) {
      Object.keys(yearly)
        .sort((a, b) => b.localeCompare(a))
        .forEach((year) => {
          (yearly[year] || []).forEach((item) => rows.push({ ...item, year }));
        });
    } else if (Array.isArray(attrs.monthList)) {
      attrs.monthList.forEach((item) => {
        const month = String(item?.month || "");
        rows.push({ ...item, year: month.slice(0, 4) });
      });
    }
    return rows
      .filter((row) => row.month)
      .sort((a, b) => String(b.month).localeCompare(String(a.month)));
  }

  rowsByYear() {
    return this.billRows().reduce((acc, row) => {
      const year = row.year || String(row.month).slice(0, 4) || "未知";
      if (!acc[year]) acc[year] = [];
      acc[year].push(row);
      return acc;
    }, {});
  }

  availableYears() {
    return Object.keys(this.rowsByYear()).sort((a, b) => b.localeCompare(a));
  }

  selectedYear() {
    const years = this.availableYears();
    if (!years.length) return "";
    if (years.includes(this.activeYear)) return this.activeYear;
    return years.includes(this.config?.year) ? this.config.year : years[0];
  }

  yearRows() {
    const grouped = this.rowsByYear();
    return grouped[this.selectedYear()] || [];
  }

  render(force = false) {
    if (!this.config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const key = JSON.stringify({
      config: this.config,
      device: this.device?.id,
      entities: this.entities,
      states: Object.values(this.entities || {}).map((entityId) => [
        entityId,
        this._hass?.states?.[entityId]?.state,
        this._hass?.states?.[entityId]?.last_updated,
        this._hass?.states?.[entityId]?.attributes?.最后更新,
        this._hass?.states?.[entityId]?.attributes?.最新月份,
        this._hass?.states?.[entityId]?.attributes?.yearly_billings,
        this._hass?.states?.[entityId]?.attributes?.monthList,
      ]),
      discovering: this.discovering,
      error: this.discoveryError?.message || "",
      activeYear: this.activeYear,
      activeTab: this._activeTab,
    });
    if (!force && key === this.renderKey) return;
    this.renderKey = key;

    const hasEntities = Object.keys(this.entities || {}).length > 0;
    const subtitle = this.device?.name_by_user || this.device?.name || "自动匹配硒泉水表设备";
    this.shadowRoot.innerHTML = `
      <ha-card>
        <style>${this.styles()}</style>
        <div class="card">
          <div class="header">
            <div>
              <div class="title">${this.escape(this.config.title || "硒泉供水")}</div>
              <div class="subtitle">${this.escape(subtitle)}</div>
            </div>
            <ha-icon icon="mdi:water-circle"></ha-icon>
          </div>
          ${this.discoveryError ? `<div class="message">实体读取失败：${this.escape(this.discoveryError.message || this.discoveryError)}</div>` : ""}
          ${this.discovering && !hasEntities ? `<div class="message">正在读取硒泉供水实体...</div>` : ""}
          ${!this.discovering && !hasEntities ? `<div class="message">未找到水表实体，请在卡片编辑器选择水表设备。</div>` : ""}
          ${hasEntities ? this.renderContent() : ""}
        </div>
      </ha-card>
    `;
    this.ensureHandlers();
    if (this.activeTab() === "payment") {
      setTimeout(() => {
        const paymentChart = this.shadowRoot?.querySelector('.combo-chart[data-chart-type="payment"]');
        if (paymentChart) {
          paymentChart.scrollLeft = paymentChart.scrollWidth;
        }
      }, 100);
    }
  }

  renderContent() {
    const billRows = this.yearRows();
    const allRows = this.billRows();
    const year = this.selectedYear();
    const totalAmount = billRows.reduce((sum, row) => sum + this.number(row.amount), 0);
    const totalUsage = billRows.reduce((sum, row) => sum + this.number(row.usage), 0);
    const latestRow = allRows[0] || {};
    const latestMonth = allRows[0]?.month || this.billEntity()?.attributes?.最新月份 || "--";
    const balance = this.state("balance");
    const annualUsage = this.state("annual_usage");
    const latestBill = this.state("latest_bill");
    const detail = this.billEntity()?.attributes?.使用详情 || {};
    const lastUpdate = this.billEntity()?.attributes?.最后更新 || "";
    const tab = this.activeTab();
    return `
      <div class="utility-main">
        <div class="utility-title-row">
          <div class="top-content">
            <div class="water-icon"><img src="/xiquan_water/icon.png" alt=""></div>
            <div>
              <div class="title-line">
                <div class="title-in-card">硒泉供水</div>
              </div>
              <div class="muted">${this.escape(this.device?.name_by_user || this.device?.name || "水表")}${lastUpdate ? ` · 更新 ${this.escape(this.shortDateTime(lastUpdate))}` : ""}</div>
            </div>
          </div>
        </div>
        <button class="balance-section" data-entity-id="${this.escape(this.entity("balance") || "")}">
          <div class="usage-title"><ha-icon icon="mdi:cash"></ha-icon>水费余额</div>
          <div class="balance-info">
            <div class="balance-amount">${this.escape(balance?.state ?? "--")}<span>元</span></div>
          </div>
        </button>

        <div class="right-section">
          <div class="usage-grid">
            ${this.infoTile("年度用水", annualUsage?.state ?? "--", annualUsage?.attributes?.unit_of_measurement || "m³", "mdi:water-percent", this.entity("annual_usage"))}
            ${this.infoTile(
              "最新账单",
              latestBill?.state ?? "--",
              latestBill?.attributes?.unit_of_measurement || "元",
              "mdi:receipt-text-outline",
              this.entity("latest_bill")
            )}
          </div>
        </div>
      </div>

      <div class="tab-controls">
        ${Object.entries(TABS).map(([key, label]) => `
          <button class="tab-btn ${tab === key ? "active" : ""}" data-tab="${this.escape(key)}">${this.escape(label)}</button>
        `).join("")}
      </div>

      ${tab === "chart" || tab === "calendar" ? `
        <div class="bill-overview">
          <div>
            <div class="section-title">${this.escape(year || "账单")}账单</div>
          </div>
          <div class="section-subtitle">最新月份 ${this.escape(this.monthLabel(latestMonth))} · 共 ${allRows.length} 期</div>
        </div>

        <div class="control-row">
          <div class="year-tabs">
            ${this.availableYears().map((item) => `
              <button class="${item === year ? "active" : ""}" data-year="${this.escape(item)}">${this.escape(item)}</button>
            `).join("")}
          </div>
        </div>
        <div class="year-total-grid">
          ${this.infoTile(`${this.escape(year || "年度")}水费`, this.format(totalAmount), "元", "mdi:cash-multiple")}
          ${this.infoTile(`${this.escape(year || "年度")}用水`, this.format(totalUsage), "m³", "mdi:chart-bar")}
        </div>
      ` : ""}

      ${tab === "chart" ? (billRows.length ? this.renderChart(billRows) : `<div class="message">暂无账单历史。</div>`) : ""}
      ${tab === "calendar" ? (this.config.show_calendar === false || !billRows.length ? `<div class="message">暂无账单历史。</div>` : this.renderCalendar(billRows)) : ""}
      ${tab === "payment" ? (this.config.show_payment_records === false ? `<div class="message">充值记录已隐藏。</div>` : this.renderPaymentRecords()) : ""}
    `;
  }

  infoTile(label, value, unit, icon, entityId = "", detail = "") {
    return `
      <button class="usage-section" data-entity-id="${this.escape(entityId || "")}">
        <div class="usage-title">
          <ha-icon icon="${icon}"></ha-icon>
          ${label}
        </div>
        <div class="usage-amount">
          <span>${this.escape(value)}</span>
          <small>${this.escape(unit)}</small>
        </div>
        ${detail ? `<div class="usage-detail">${detail}</div>` : ""}
      </button>
    `;
  }

  metric(key, primary = false) {
    const meta = SENSOR_KEYS[key];
    const state = this.state(key);
    const entityId = this.entity(key) || "";
    const unit = state?.attributes?.unit_of_measurement || meta.unit || "";
    const value = state ? `${state.state}${unit ? ` ${unit}` : ""}` : "--";
    return `
      <button class="metric ${primary ? "primary" : ""}" data-entity-id="${this.escape(entityId)}">
        <ha-icon icon="${meta.icon}"></ha-icon>
        <span>${this.escape(meta.label)}</span>
        <strong>${this.escape(value)}</strong>
      </button>
    `;
  }

  renderChart(rows) {
    const chartRows = [...rows].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const usages = chartRows.map((row) => this.number(row.usage));
    const amounts = chartRows.map((row) => this.number(row.amount));
    const width = 360;
    const height = 190;
    const padLeft = 46;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 24;
    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const maxAmount = Math.max(...amounts, 1);
    const maxUsage = Math.max(...usages, 1);
    const maxCombined = Math.max(maxAmount, maxUsage, 1);
    const slot = innerWidth / Math.max(chartRows.length, 1);
    const barWidth = Math.max(8, slot * 0.54);
    const axisMax = this.niceAxisMax(maxCombined);
    const ticks = [axisMax, axisMax * 0.75, axisMax * 0.5, axisMax * 0.25, 0];
    const x = (index) => {
      if (chartRows.length <= 1) return width / 2;
      return padLeft + slot * index + slot / 2;
    };
    const chartBottom = padTop + innerHeight;
    const yCombined = (value) => chartBottom - (value / axisMax) * innerHeight;
    const linePoints = usages.map((value, index) => `${x(index).toFixed(1)},${yCombined(value).toFixed(1)}`).join(" ");
    return `
      <div class="chart-wrap">
        <div class="chart-head">
          <div>
            <div class="section-title">账单趋势</div>
            <div class="section-subtitle">柱状为水费，折线为用水量</div>
          </div>
        </div>
        <div class="combo-chart">
          <svg class="combo-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            ${ticks.map((tick) => {
              const y = yCombined(tick);
              return `
                <line class="chart-grid" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" />
                <text class="axis-label" x="${padLeft - 10}" y="${(y + 3).toFixed(1)}">${this.escape(this.axisLabel(tick))}</text>
              `;
            }).join("")}
            <line class="chart-axis" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${chartBottom}" />
            <line class="chart-base" x1="${padLeft}" y1="${chartBottom}" x2="${width - padRight}" y2="${chartBottom}" />
            ${chartRows.map((row, index) => {
              const amount = amounts[index];
              const usage = usages[index];
              const center = x(index);
              const barHeight = Math.max(3, chartBottom - yCombined(amount));
              const barX = center - barWidth / 2;
              const barY = chartBottom - barHeight;
              return `
                <rect class="amount-bar" x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3"></rect>
                <text class="amount-label" x="${center.toFixed(1)}" y="${Math.max(10, yCombined(amount) - 8).toFixed(1)}">${this.escape(this.format(amount))}</text>
                <text class="month-label" x="${center.toFixed(1)}" y="${height - 6}">${this.escape(String(row.month).slice(4, 6))}</text>
                <rect class="hit-area" data-chart-index="${index}" x="${(padLeft + slot * index).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height}" fill="transparent"></rect>
              `;
            }).join("")}
            <polyline class="usage-polyline" points="${linePoints}" />
            ${usages.map((value, index) => `
              <circle class="usage-point" cx="${x(index).toFixed(1)}" cy="${yCombined(value).toFixed(1)}" r="3.2" />
            `).join("")}
          </svg>
          <div class="chart-tooltip"></div>
        </div>
        <div class="legend">
          <span><i style="background: ${AMOUNT_COLOR}"></i>水费 (元)</span>
          <span><i class="line-dot"></i>用水量 (m³)</span>
        </div>
      </div>
    `;
  }

  renderCalendar(rows) {
    const byMonth = new Map(rows.map((row) => [String(row.month).slice(4, 6), row]));
    return `
      <div class="calendar-wrap">
        <div class="calendar-head">
          <div>
            <div class="section-title">${this.escape(this.selectedYear())} 月历账单</div>
            <div class="section-subtitle">按月份查看水费、用水量和抄表读数</div>
          </div>
        </div>
        <div class="month-calendar">
          ${Array.from({ length: 12 }, (_, index) => {
            const month = String(index + 1).padStart(2, "0");
            const row = byMonth.get(month);
            return row ? `
              <div class="month-cell filled">
                <div class="month-name">${month}月</div>
                <div class="month-amount">${this.format(row.amount)}<span>元</span></div>
                <div class="month-usage">${this.format(row.usage)} m³</div>
                <div class="month-reading">${this.escape(row.lastReading ?? "--")} → ${this.escape(row.reading ?? "--")}</div>
              </div>
            ` : `
              <div class="month-cell empty">
                <div class="month-name">${month}月</div>
                <div class="month-empty">暂无账单</div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  renderPaymentRecords() {
    const rows = this.paymentRows();
    if (!rows.length) {
      return `
        <div class="chart-wrap">
          <div class="chart-head">
            <div>
              <div class="section-title">充值记录</div>
              <div class="section-subtitle">暂无充值记录</div>
            </div>
          </div>
        </div>
      `;
    }
    const totalPayment = rows.reduce((sum, row) => sum + this.number(row.money), 0);
    const chartRows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const amounts = chartRows.map((row) => this.number(row.money));
    const visibleBars = 7;
    const slotWidth = 48;
    const padLeft = 46;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 38;
    const chartHeight = 224;
    const chartWidth = padLeft + chartRows.length * slotWidth + padRight;
    const innerHeight = chartHeight - padTop - padBottom;
    const maxAmount = Math.max(...amounts, 1);
    const barWidth = Math.max(8, slotWidth * 0.54);
    const axisMax = this.niceAxisMax(maxAmount);
    const ticks = [axisMax, axisMax * 0.75, axisMax * 0.5, axisMax * 0.25, 0];
    const x = (index) => padLeft + slotWidth * index + slotWidth / 2;
    const chartBottom = padTop + innerHeight;
    const yPos = (value) => chartBottom - (value / axisMax) * innerHeight;
    return `
      <div class="chart-wrap">
        <div class="chart-head">
          <div>
            <div class="section-title">充值记录</div>
            <div class="section-subtitle">共 ${rows.length} 笔 · 累计 ${this.format(totalPayment)} 元</div>
          </div>
        </div>
        <div class="combo-chart" data-chart-type="payment">
          <svg class="combo-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" width="${chartWidth}" height="${chartHeight}">
            ${ticks.map((tick) => {
              const y = yPos(tick);
              return `
                <line class="chart-grid" x1="${padLeft}" y1="${y.toFixed(1)}" x2="${chartWidth - padRight}" y2="${y.toFixed(1)}" />
                <text class="axis-label" x="${padLeft - 10}" y="${(y + 3).toFixed(1)}">${this.escape(this.axisLabel(tick))}</text>
              `;
            }).join("")}
            <line class="chart-axis" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${chartBottom}" />
            <line class="chart-base" x1="${padLeft}" y1="${chartBottom}" x2="${chartWidth - padRight}" y2="${chartBottom}" />
            ${chartRows.map((row, index) => {
              const amount = amounts[index];
              const center = x(index);
              const barHeight = Math.max(3, chartBottom - yPos(amount));
              const barX = center - barWidth / 2;
              const barY = chartBottom - barHeight;
              const dateStr = row.date ? this.shortDate(row.date) : "";
              return `
                <rect class="amount-bar" x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3"></rect>
                <text class="amount-label" x="${center.toFixed(1)}" y="${Math.max(10, yPos(amount) - 8).toFixed(1)}">${this.escape(this.format(amount))}</text>
                <text class="month-label" x="${center.toFixed(1)}" y="${chartBottom + 14}">${this.escape(dateStr)}</text>
                <rect class="hit-area" data-chart-index="${index}" data-date="${this.escape(row.date || "")}" data-money="${amount}" x="${(padLeft + slotWidth * index).toFixed(1)}" y="0" width="${slotWidth.toFixed(1)}" height="${chartHeight}" fill="transparent"></rect>
              `;
            }).join("")}
          </svg>
        </div>
        <div class="chart-tooltip"></div>
        <div class="legend">
          <span><i style="background: ${AMOUNT_COLOR}"></i>充值金额 (元)</span>
        </div>
      </div>
    `;
  }

  ensureHandlers() {
    if (!this.shadowRoot || this._clickHandler) return;
    this._clickHandler = (event) => {
      const year = event.target.closest("[data-year]");
      if (year && this.shadowRoot.contains(year)) {
        event.stopPropagation();
        this.activeYear = year.dataset.year;
        this.render(true);
        return;
      }

      const tab = event.target.closest("[data-tab]");
      if (tab && this.shadowRoot.contains(tab)) {
        event.stopPropagation();
        this._activeTab = tab.dataset.tab;
        this.render(true);
        return;
      }

      const target = event.target.closest("[data-entity-id]");
      if (!target || !this.shadowRoot.contains(target)) return;
      const entityId = target.dataset.entityId;
      if (!entityId) return;
      event.stopPropagation();
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }));
    };
    this.shadowRoot.addEventListener("click", this._clickHandler);

    this._moveHandler = (event) => this.updateChartTooltip(event);
    this._leaveHandler = () => this.hideChartTooltip();
    this.shadowRoot.addEventListener("pointermove", this._moveHandler);
    this.shadowRoot.addEventListener("pointerleave", this._leaveHandler);
    this.shadowRoot.addEventListener("touchstart", this._moveHandler, { passive: true });
    this.shadowRoot.addEventListener("touchmove", this._moveHandler, { passive: true });
  }

  updateChartTooltip(event) {
    if (!this.shadowRoot) return;
    const chart = event.target.closest?.(".combo-chart");
    if (!chart || !this.shadowRoot.contains(chart)) {
      this.hideChartTooltip();
      return;
    }

    const chartType = chart.dataset.chartType;
    if (chartType === "payment") {
      if (event.pointerType === "touch") {
        this.hideChartTooltip();
        return;
      }
      const hitArea = event.target.closest?.(".hit-area");
      if (!hitArea) {
        this.hideChartTooltip();
        return;
      }

      const index = parseInt(hitArea.dataset.chartIndex);
      const date = hitArea.dataset.date;
      const money = parseFloat(hitArea.dataset.money);

      chart.querySelectorAll(".hit-area.active").forEach((node) => node.classList.remove("active"));
      hitArea.classList.add("active");

      const chartWrap = chart.closest(".chart-wrap");
      const tooltip = chartWrap?.querySelector(".chart-tooltip");
      if (!tooltip) return;

      tooltip.innerHTML = `
        <div class="tooltip-title">${this.escape(this.formatDate(date))}</div>
        <div><span>充值金额</span><strong>${this.format(money)} 元</strong></div>
      `;

      const chartWrapRect = chartWrap.getBoundingClientRect();
      const hitRect = hitArea.getBoundingClientRect();
      const hitCenterX = hitRect.left + hitRect.width / 2;
      const chartTop = chart.getBoundingClientRect().top;
      const tooltipTop = chartTop - chartWrapRect.top + 12;
      const x = Math.max(82, Math.min(chartWrapRect.width - 82, hitCenterX - chartWrapRect.left));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${tooltipTop}px`;
      tooltip.classList.add("visible");
      return;
    }

    const rows = [...this.yearRows()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
    if (!rows.length) return;

    const rect = chart.getBoundingClientRect();
    const point = event.touches?.[0] || event;
    const x = Math.max(0, Math.min(rect.width, point.clientX - rect.left));
    const index = Math.max(0, Math.min(rows.length - 1, Math.round((x / rect.width) * (rows.length - 1))));
    const row = rows[index];
    if (!row) return;

    chart.querySelectorAll(".hit-area.active").forEach((node) => node.classList.remove("active"));
    chart.querySelector(`.hit-area[data-chart-index="${index}"]`)?.classList.add("active");

    const tooltip = chart.querySelector(".chart-tooltip");
    if (!tooltip) return;

    tooltip.innerHTML = `
      <div class="tooltip-title">${this.escape(this.monthLabel(row.month))}</div>
      <div><span>水费</span><strong>${this.format(row.amount)} 元</strong></div>
      <div><span>用水量</span><strong>${this.format(row.usage)} m³</strong></div>
      <div><span>读数</span><strong>${this.escape(row.lastReading ?? "--")} → ${this.escape(row.reading ?? "--")}</strong></div>
    `;
    const left = Math.max(82, Math.min(rect.width - 82, x));
    tooltip.style.left = `${left}px`;
    tooltip.classList.add("visible");
  }

  hideChartTooltip() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelector(".chart-tooltip")?.classList.remove("visible");
    this.shadowRoot.querySelectorAll(".hit-area.active").forEach((node) => node.classList.remove("active"));
  }

  number(value) {
    const num = Number.parseFloat(value);
    return Number.isFinite(num) ? num : 0;
  }

  format(value) {
    const num = this.number(value);
    return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, "");
  }

  niceAxisMax(value) {
    const raw = Math.max(1, Number(value) || 1);
    const exponent = Math.floor(Math.log10(raw));
    const fraction = raw / 10 ** exponent;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * 10 ** exponent;
  }

  axisLabel(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "";
    return Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, "");
  }

  monthLabel(month) {
    const text = String(month || "");
    if (text.length === 6) return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
    return text || "--";
  }

  shortDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  shortDate(value) {
    if (!value) return "";
    const text = String(value);
    if (/^\d{8}$/.test(text)) {
      return `${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    if (/^\d{6}$/.test(text)) {
      return `${text.slice(4, 6)}月`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text.slice(5, 10);
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${month}-${day}`;
    }
    return text.length > 5 ? text.slice(-5) : text;
  }

  formatDate(value) {
    if (!value) return "--";
    const text = String(value);
    if (/^\d{8}$/.test(text)) {
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      return text;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    return text;
  }

  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }

  styles() {
    return `
      :host { display: block; }
      ha-card { overflow: hidden; }
      .card { padding: 16px; }
      .header { display: none; }
      .title, .title-in-card { color: var(--primary-text-color); font-size: 19px; font-weight: 700; line-height: 1.25; }
      .title-in-card { font-size: 18px; }
      .title-line { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .subtitle, .section-subtitle, .muted { color: var(--secondary-text-color); font-size: 12px; margin-top: 3px; }
      .message { color: var(--secondary-text-color); padding: 14px 0 2px; }
      button { font: inherit; color: inherit; }
      [data-entity-id=""] { cursor: default; opacity: .55; }

      .utility-main { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; padding: 10px; border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 22%, transparent); border-radius: 8px; background: linear-gradient(145deg, color-mix(in srgb, ${WATER_ACCENT} 10%, transparent), color-mix(in srgb, var(--card-background-color) 28%, transparent)); backdrop-filter: blur(2px); }
      .utility-title-row { grid-column: 1 / -1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .balance-section { min-width: 0; min-height: 86px; padding: 10px; border: 0; border-radius: 8px; background: color-mix(in srgb, ${WATER_ACCENT} 5%, transparent); display: flex; flex-direction: column; justify-content: space-between; text-align: left; cursor: pointer; box-shadow: inset 0 0 0 1px color-mix(in srgb, ${WATER_ACCENT} 12%, transparent); backdrop-filter: blur(2px); }
      .top-content { display: flex; align-items: center; gap: 10px; }
      .water-icon { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, ${WATER_ACCENT} 13%, transparent); color: ${WATER_ACCENT}; }
      .water-icon ha-icon { --mdc-icon-size: 26px; }
      .water-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 50%; display: block; }
      .balance-info { margin-top: 8px; padding: 0; border-radius: 0; background: transparent; }
      .balance-amount { color: var(--primary-text-color); font-size: 27px; font-weight: 760; line-height: 1; letter-spacing: 0; }
      .balance-amount span { margin-left: 4px; font-size: 15px; font-weight: 650; color: var(--secondary-text-color); }
      .balance-label { margin-top: 6px; color: var(--secondary-text-color); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .balance-time { color: var(--secondary-text-color); font-size: 11px; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .right-section { min-width: 0; display: contents; }
      .usage-grid { display: contents; }
      .usage-section { min-width: 0; min-height: 86px; padding: 10px; border: 0; border-radius: 8px; background: color-mix(in srgb, ${WATER_ACCENT} 5%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, ${WATER_ACCENT} 12%, transparent); text-align: left; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; backdrop-filter: blur(2px); }
      .usage-title { display: inline-flex; align-items: center; gap: 6px; color: var(--secondary-text-color); font-size: 12px; min-width: 0; }
      .usage-title ha-icon { color: ${WATER_ACCENT}; --mdc-icon-size: 16px; }
      .usage-amount { color: var(--primary-text-color); font-size: 25px; font-weight: 720; line-height: 1.1; word-break: break-word; }
      .usage-amount small { margin-left: 3px; color: var(--secondary-text-color); font-size: 13px; font-weight: 650; }
      .usage-detail { margin-top: 5px; color: var(--secondary-text-color); font-size: 10px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .year-total-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0 0 14px; }
      .year-total-grid .usage-section { min-height: 76px; box-shadow: inset 0 0 0 1px color-mix(in srgb, ${WATER_ACCENT} 18%, transparent); background: color-mix(in srgb, ${WATER_ACCENT} 8%, transparent); }

      .bill-overview { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 2px 0 10px; }
      .latest-detail { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; color: var(--secondary-text-color); font-size: 12px; }
      .latest-detail span { min-height: 28px; padding: 6px 9px; border-radius: 7px; background: color-mix(in srgb, ${WATER_ACCENT} 9%, transparent); box-sizing: border-box; }
      .section-title { color: var(--primary-text-color); font-size: 16px; font-weight: 650; }
      .tab-controls { display: flex; gap: 6px; margin: 12px 0; }
      .tab-btn { flex: 1; height: 32px; min-width: 80px; padding: 0 11px; border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 16%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--card-background-color) 30%, transparent); color: var(--secondary-text-color); font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s ease; backdrop-filter: blur(2px); }
      .tab-btn.active { background: color-mix(in srgb, ${WATER_ACCENT} 16%, transparent); border-color: ${WATER_ACCENT}; color: ${WATER_ACCENT}; }
      .control-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
      .year-tabs { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
      .year-tabs button { height: 32px; min-width: 58px; padding: 0 11px; border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 16%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--card-background-color) 30%, transparent); cursor: pointer; backdrop-filter: blur(2px); }
      .year-tabs button.active { background: color-mix(in srgb, ${WATER_ACCENT} 16%, transparent); border-color: ${WATER_ACCENT}; color: ${WATER_ACCENT}; }
      .chart-wrap { position: relative; border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 18%, transparent); border-radius: 8px; padding: 12px; background: color-mix(in srgb, var(--card-background-color) 24%, transparent); backdrop-filter: blur(2px); }
      .chart-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
      .combo-chart { position: relative; height: 224px; touch-action: none; }
      .combo-chart[data-chart-type="payment"] { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; touch-action: pan-x; }
      .combo-svg { width: 100%; height: 100%; display: block; overflow: hidden; }
      .combo-chart[data-chart-type="payment"] .combo-svg { width: auto; height: auto; }
      .chart-base { stroke: var(--divider-color); stroke-width: 1; vector-effect: non-scaling-stroke; }
      .chart-axis { stroke: var(--divider-color); stroke-width: 1; opacity: .85; vector-effect: non-scaling-stroke; }
      .chart-grid { stroke: var(--divider-color); stroke-width: 1; opacity: .42; vector-effect: non-scaling-stroke; }
      .axis-label { fill: var(--secondary-text-color); font-size: 9px; text-anchor: end; }
      .amount-bar { fill: ${AMOUNT_COLOR}; opacity: .82; }
      .amount-label { fill: var(--secondary-text-color); font-size: 9px; text-anchor: middle; }
      .month-label { fill: var(--secondary-text-color); font-size: 10px; text-anchor: middle; }
      .usage-polyline { fill: none; stroke: ${USAGE_COLOR}; stroke-width: 2.8; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
      .usage-point { fill: color-mix(in srgb, var(--card-background-color) 72%, transparent); stroke: ${USAGE_COLOR}; stroke-width: 2.4; vector-effect: non-scaling-stroke; }
      .usage-polyline, .usage-point { pointer-events: none; }
      .hit-area { cursor: crosshair; pointer-events: all; }
      .hit-area.active { fill: color-mix(in srgb, var(--accent-color) 10%, transparent); }
      .chart-tooltip { position: absolute; top: 12px; left: 50%; min-width: 150px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--card-background-color) 72%, transparent); border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 18%, transparent); box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0, 0, 0, .18)); color: var(--primary-text-color); font-size: 12px; pointer-events: none; opacity: 0; transform: translateX(-50%); transition: opacity .12s ease; z-index: 3; backdrop-filter: blur(3px); }
      .chart-tooltip.visible { opacity: 1; }
      .tooltip-title { color: var(--primary-text-color); font-weight: 700; margin-bottom: 5px; }
      .chart-tooltip div:not(.tooltip-title) { display: flex; justify-content: space-between; gap: 12px; margin-top: 3px; }
      .chart-tooltip span { color: var(--secondary-text-color); }
      .chart-tooltip strong { font-weight: 650; white-space: nowrap; }
      .legend { display: flex; gap: 12px; color: var(--secondary-text-color); font-size: 12px; margin-top: 8px; }
      .legend span { display: inline-flex; align-items: center; gap: 5px; }
      .legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .legend .line-dot { background: ${USAGE_COLOR}; height: 3px; border-radius: 2px; }
      .calendar-wrap { margin-top: 12px; border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 18%, transparent); border-radius: 8px; padding: 12px; background: color-mix(in srgb, var(--card-background-color) 22%, transparent); backdrop-filter: blur(2px); }
      .calendar-head { margin-bottom: 10px; }
      .month-calendar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
      .month-cell { min-width: 0; min-height: 104px; border-radius: 8px; padding: 10px; box-sizing: border-box; border: 1px solid color-mix(in srgb, ${WATER_ACCENT} 16%, transparent); background: color-mix(in srgb, var(--card-background-color) 34%, transparent); backdrop-filter: blur(2px); }
      .month-cell.filled { background: color-mix(in srgb, ${WATER_ACCENT} 10%, transparent); }
      .month-cell.empty { opacity: .55; }
      .month-name { color: var(--secondary-text-color); font-size: 12px; margin-bottom: 8px; }
      .month-amount { color: var(--primary-text-color); font-size: 19px; font-weight: 730; line-height: 1.1; }
      .month-amount span { margin-left: 2px; color: var(--secondary-text-color); font-size: 12px; font-weight: 600; }
      .month-usage { margin-top: 5px; color: ${USAGE_COLOR}; font-size: 13px; font-weight: 650; }
      .month-reading, .month-empty { margin-top: 5px; color: var(--secondary-text-color); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      @media (max-width: 560px) {
        .card { padding: 12px; }
        .utility-main { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 8px; }
        .balance-section { min-height: 76px; padding: 8px; }
        .top-content { gap: 9px; }
        .water-icon { width: 36px; height: 36px; }
        .water-icon ha-icon { --mdc-icon-size: 22px; }
        .title-in-card { font-size: 17px; }
        .title-line { gap: 7px; }
        .balance-info { margin-top: 6px; padding: 0; }
        .balance-amount { font-size: 23px; }
        .balance-amount span { font-size: 11px; }
        .balance-label, .balance-time { font-size: 9px; }
        .usage-section { min-height: 76px; padding: 8px; }
        .usage-title { font-size: 11px; }
        .usage-title ha-icon { --mdc-icon-size: 14px; }
        .usage-amount { font-size: 21px; }
        .usage-amount small { font-size: 11px; }
        .usage-detail { font-size: 8px; }
        .year-total-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
        .year-total-grid .usage-section { min-height: 68px; }
        .chart-head, .control-row { flex-direction: column; align-items: stretch; }
        .bill-overview { align-items: baseline; }
        .year-tabs, .latest-detail { justify-content: flex-start; }
        .year-tabs { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
        .year-tabs::-webkit-scrollbar { display: none; }
        .year-tabs button { min-width: 58px; flex: 0 0 auto; }
        .chart-wrap { padding: 10px; }
        .combo-chart { height: 224px; }
        .axis-label { font-size: 8px; }
        .amount-label { font-size: 8px; }
        .month-label { font-size: 9px; }
        .legend { font-size: 11px; gap: 10px; }
        .calendar-wrap { padding: 10px; }
        .month-calendar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; overflow: visible; padding-bottom: 0; }
        .month-cell { min-height: 74px; padding: 6px; display: block; }
        .month-cell.empty { min-height: 74px; }
        .month-name { margin-bottom: 4px; font-size: 10px; }
        .month-amount { font-size: 13px; }
        .month-amount span { font-size: 9px; }
        .month-usage { margin-top: 3px; font-size: 10px; }
        .month-reading, .month-empty { margin-top: 3px; font-size: 9px; }
      }
    `;
  }
}

class XiquanWaterCardEditor extends HTMLElement {
  setConfig(config) {
    this.config = {
      title: "硒泉供水",
      show_calendar: true,
      show_payment_records: true,
      ...config,
    };
    this.renderIfNeeded(true);
  }

  set hass(hass) {
    this._hass = hass;
    this.loadDevices();
    if (!this.shadowRoot) this.renderIfNeeded(true);
  }

  async loadDevices() {
    if (!this._hass?.callWS || this.loadingDevices || this.devices) return;
    this.loadingDevices = true;
    try {
      const devices = await this._hass.callWS({ type: "config/device_registry/list" });
      this.devices = devices
        .filter((device) => isXiquanDevice(device))
        .map((device) => ({
          id: device.id,
          name: device.name_by_user || device.name || device.id,
          model: device.model || "",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } finally {
      this.loadingDevices = false;
      this.renderIfNeeded(true);
    }
  }

  renderIfNeeded(force = false) {
    const key = JSON.stringify({
      config: this.config,
      devices: this.devices,
      loading: this.loadingDevices,
    });
    if (!force && key === this.renderKey) return;
    this.renderKey = key;
    this.render();
  }

  render() {
    if (!this.config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const devices = this.devices || [];
    this.shadowRoot.innerHTML = `
      <style>
        .editor { display: grid; gap: 12px; }
        label { display: grid; gap: 6px; color: var(--secondary-text-color); font-size: 12px; }
        input, select { box-sizing: border-box; width: 100%; height: 40px; padding: 0 10px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); font: inherit; }
        .checks label { display: flex; align-items: center; gap: 8px; color: var(--primary-text-color); font-size: 14px; }
        input[type="checkbox"] { width: 18px; height: 18px; }
      </style>
      <div class="editor">
        <label>
          标题
          <input data-key="title" value="${this.escape(this.config.title || "")}">
        </label>
        <label>
          水表设备
          <select data-key="device_id">
            <option value="">自动选择</option>
            ${devices.map((device) => `
              <option value="${this.escape(device.id)}" ${this.config.device_id === device.id ? "selected" : ""}>
                ${this.escape(device.name)}${device.model ? ` (${this.escape(device.model)})` : ""}
              </option>
            `).join("")}
          </select>
        </label>
        <div class="checks">
          <label><input type="checkbox" data-key="show_calendar" ${this.config.show_calendar !== false ? "checked" : ""}>显示月历视图</label>
          <label><input type="checkbox" data-key="show_payment_records" ${this.config.show_payment_records !== false ? "checked" : ""}>显示充值记录</label>
        </div>
      </div>
    `;
    this.shadowRoot.querySelectorAll("[data-key]").forEach((element) => {
      element.addEventListener("change", () => this.valueChanged(element));
    });
  }

  valueChanged(element) {
    const key = element.dataset.key;
    const value = element.type === "checkbox" ? element.checked : element.value;
    const config = { ...this.config, [key]: value };
    if (key === "device_id" && !value) delete config.device_id;
    this.config = config;
    this.renderKey = "";
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }

  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }
}

customElements.define(CARD_TYPE, XiquanWaterCard);
customElements.define("xiquan-water-card-editor", XiquanWaterCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TYPE,
  name: "硒泉供水卡片",
  description: "显示硒泉供水余额、年度用水和按年归类的历史账单图表。",
  preview: true,
});

console.info("%cXiquan Water Card%c loaded", "color: #1f8a70; font-weight: 700", "");
