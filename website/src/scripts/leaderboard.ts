type SortKey =
  | "rank"
  | "adapter"
  | "model"
  | "thinking"
  | "passRate"
  | "coverage"
  | "passAtK"
  | "score"
  | "pass"
  | "scored"
  | "avgMs";

const sortAttributes: Record<SortKey, string> = {
  rank: "rank",
  adapter: "adapter",
  model: "model",
  thinking: "thinking-sort",
  passRate: "pass-rate",
  coverage: "coverage",
  passAtK: "pass-at-k",
  score: "fixture-score",
  pass: "pass",
  scored: "scored",
  avgMs: "avg-ms",
};

let globalMenusBound = false;
let globalExpandBound = false;

function menuValue(menu: HTMLElement | null): string {
  return menu?.dataset.value ?? "all";
}

function closeMenu(menu: HTMLElement | null): void {
  if (!menu) return;
  menu.classList.remove("lb-menu--open");
  menu
    .querySelector(".lb-menu__trigger")
    ?.setAttribute("aria-expanded", "false");
  const panel = menu.querySelector<HTMLElement>(".lb-menu__panel");
  if (panel) panel.hidden = true;
}

function closeAllMenus(except: HTMLElement | null = null): void {
  for (const menu of document.querySelectorAll<HTMLElement>(
    ".lb-menu.lb-menu--open",
  )) {
    if (menu === except) continue;
    closeMenu(menu);
  }
}

function openMenu(menu: HTMLElement): void {
  closeAllMenus(menu);
  menu.classList.add("lb-menu--open");
  menu
    .querySelector(".lb-menu__trigger")
    ?.setAttribute("aria-expanded", "true");
  const panel = menu.querySelector<HTMLElement>(".lb-menu__panel");
  if (panel) panel.hidden = false;
}

function toggleMenu(menu: HTMLElement): void {
  if (menu.classList.contains("lb-menu--open")) closeMenu(menu);
  else openMenu(menu);
}

function setMenuValue(menu: HTMLElement | null, value: string): void {
  if (!menu) return;
  menu.dataset.value = value;
  menu.classList.toggle("lb-menu--active", value !== "all");

  let label = "All";
  for (const option of menu.querySelectorAll<HTMLElement>(".lb-menu__option")) {
    const selected = (option.dataset.value ?? "") === value;
    option.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) {
      const text = option.querySelector("span")?.textContent?.trim() ?? value;
      label =
        value === "all"
          ? menu.hasAttribute("data-lb-thinking")
            ? "Any"
            : "All"
          : text;
    }
  }

  const valueElement = menu.querySelector<HTMLElement>("[data-lb-menu-value]");
  if (valueElement) valueElement.textContent = label;
  closeMenu(menu);
}

function bindMenu(menu: HTMLElement | null, onChange: () => void): void {
  if (!menu) return;
  menu
    .querySelector(".lb-menu__trigger")
    ?.addEventListener("click", () => toggleMenu(menu));
  for (const option of menu.querySelectorAll<HTMLElement>(".lb-menu__option")) {
    option.addEventListener("click", () => {
      setMenuValue(menu, option.dataset.value ?? "all");
      onChange();
    });
  }
}

function bindGlobalMenuDismissal(): void {
  if (globalMenusBound) return;
  globalMenusBound = true;
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const open = document.querySelector<HTMLElement>(".lb-menu.lb-menu--open");
    if (open && !open.contains(event.target)) closeAllMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllMenus();
  });
}

function findDetail(
  tbody: HTMLTableSectionElement,
  key: string,
): HTMLTableRowElement | null {
  return tbody.querySelector<HTMLTableRowElement>(
    `tr.lb-detail[data-row-key="${CSS.escape(key)}"]`,
  );
}

function setRowExpanded(row: HTMLTableRowElement, open: boolean): void {
  const key = row.dataset.rowKey;
  if (!key) return;
  const tbody = row.parentElement;
  if (!(tbody instanceof HTMLTableSectionElement)) return;
  const detail = findDetail(tbody, key);
  row.setAttribute("aria-expanded", open ? "true" : "false");
  if (detail) {
    detail.hidden = !open;
    // Keep detail visibility in sync with filter state
    if (open && row.hidden) detail.hidden = true;
  }
}

function toggleRow(row: HTMLTableRowElement): void {
  const open = row.getAttribute("aria-expanded") === "true";
  // Accordion: close others in this table for a cleaner board
  const tbody = row.parentElement;
  if (tbody instanceof HTMLTableSectionElement) {
    for (const other of tbody.querySelectorAll<HTMLTableRowElement>(
      "tr.lb-row[aria-expanded='true']",
    )) {
      if (other !== row) setRowExpanded(other, false);
    }
  }
  setRowExpanded(row, !open);
}

function bindGlobalRowExpand(): void {
  if (globalExpandBound) return;
  globalExpandBound = true;

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-lb-no-toggle]")) return;
    // Don't steal header sort clicks
    if (event.target.closest("thead")) return;
    const row = event.target.closest<HTMLTableRowElement>(
      "tr.lb-row[data-lb-row]",
    );
    if (!row) return;
    const table = row.closest("table.table");
    if (!table || table.getAttribute("data-expandable") !== "true") return;
    event.preventDefault();
    toggleRow(row);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.matches("tr.lb-row[data-lb-row]")) return;
    const table = event.target.closest("table.table");
    if (!table || table.getAttribute("data-expandable") !== "true") return;
    event.preventDefault();
    toggleRow(event.target as HTMLTableRowElement);
  });
}

function initializeTable(table: HTMLTableElement): void {
  if (table.dataset.bound === "true") return;
  table.dataset.bound = "true";

  const tbody = table.tBodies[0];
  const wrap = table.closest(".table-wrap");
  const toolbar = wrap?.previousElementSibling;
  if (
    !tbody ||
    !(toolbar instanceof HTMLElement) ||
    !toolbar.classList.contains("table-toolbar")
  )
    return;

  const adapterMenu = toolbar.querySelector<HTMLElement>("[data-lb-adapter]");
  const thinkingMenu = toolbar.querySelector<HTMLElement>("[data-lb-thinking]");
  const search = toolbar.querySelector<HTMLInputElement>("[data-lb-search]");
  const clearButton =
    toolbar.querySelector<HTMLButtonElement>("[data-lb-clear]");
  let sortKey: SortKey = "rank";
  let sortDirection: "asc" | "desc" = "asc";

  const filters = () => ({
    adapter: menuValue(adapterMenu),
    thinking: menuValue(thinkingMenu),
    query: (search?.value ?? "").trim().toLowerCase(),
  });

  const syncClear = () => {
    if (!clearButton) return;
    const { adapter, thinking, query } = filters();
    clearButton.hidden =
      adapter === "all" && thinking === "all" && query === "";
  };

  const apply = () => {
    const rows = [
      ...tbody.querySelectorAll<HTMLTableRowElement>("tr.lb-row[data-lb-row]"),
    ];
    const {
      adapter: activeAdapter,
      thinking: activeThinking,
      query,
    } = filters();

    for (const row of rows) {
      const adapterMatches =
        activeAdapter === "all" || row.dataset.adapter === activeAdapter;
      const thinkingMatches =
        activeThinking === "all" || row.dataset.thinking === activeThinking;
      const modelMatches =
        !query || (row.dataset.model ?? "").toLowerCase().includes(query);
      const visible = adapterMatches && thinkingMatches && modelMatches;
      row.hidden = !visible;

      const key = row.dataset.rowKey;
      if (!key) continue;
      const detail = findDetail(tbody, key);
      if (!detail) continue;
      if (!visible) {
        detail.hidden = true;
      } else if (row.getAttribute("aria-expanded") === "true") {
        detail.hidden = false;
      } else {
        detail.hidden = true;
      }
    }

    const type =
      table.querySelector<HTMLTableCellElement>(`th[data-sort="${sortKey}"]`)
        ?.dataset.type ?? "string";
    const attribute = sortAttributes[sortKey];
    const visible = rows.filter((row) => !row.hidden);
    visible.sort((left, right) => {
      const leftValue = left.getAttribute(`data-${attribute}`) ?? "";
      const rightValue = right.getAttribute(`data-${attribute}`) ?? "";
      const comparison =
        type === "number"
          ? (leftValue === "" ? Number.NEGATIVE_INFINITY : Number(leftValue)) -
            (rightValue === "" ? Number.NEGATIVE_INFINITY : Number(rightValue))
          : leftValue.localeCompare(rightValue, undefined, {
              sensitivity: "base",
            });
      return sortDirection === "asc" ? comparison : -comparison;
    });

    // Re-append each main row followed by its detail sibling
    for (const row of visible) {
      tbody.appendChild(row);
      const key = row.dataset.rowKey;
      if (!key) continue;
      const detail = findDetail(tbody, key);
      if (detail) tbody.appendChild(detail);
    }
    // Keep hidden rows (and their details) after visible ones
    for (const row of rows.filter((r) => r.hidden)) {
      tbody.appendChild(row);
      const key = row.dataset.rowKey;
      if (!key) continue;
      const detail = findDetail(tbody, key);
      if (detail) tbody.appendChild(detail);
    }

    for (const heading of table.querySelectorAll<HTMLTableCellElement>(
      "th[data-sort]",
    )) {
      if (heading.dataset.sort === sortKey) {
        heading.setAttribute(
          "aria-sort",
          sortDirection === "asc" ? "ascending" : "descending",
        );
      } else {
        heading.removeAttribute("aria-sort");
      }
    }
    syncClear();
  };

  bindMenu(adapterMenu, apply);
  bindMenu(thinkingMenu, apply);
  search?.addEventListener("input", apply);
  clearButton?.addEventListener("click", () => {
    setMenuValue(adapterMenu, "all");
    setMenuValue(thinkingMenu, "all");
    if (search) search.value = "";
    apply();
  });

  for (const heading of table.querySelectorAll<HTMLTableCellElement>(
    "th[data-sort]",
  )) {
    heading.addEventListener("click", () => {
      const key = heading.dataset.sort as SortKey | undefined;
      if (!key || !(key in sortAttributes)) return;
      if (sortKey === key)
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDirection = ["rank", "model", "adapter", "thinking"].includes(key)
          ? "asc"
          : "desc";
      }
      apply();
    });
  }
  apply();
}

/** Fixed-position tips so they never paint under scroll/clip containers. */
function ensureTipFloat(): HTMLElement {
  let el = document.getElementById("lb-tip-float");
  if (el) return el;
  el = document.createElement("div");
  el.id = "lb-tip-float";
  el.className = "tip-float";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

function placeTipFloat(anchor: HTMLElement, float: HTMLElement): void {
  const text = anchor.getAttribute("data-tip")?.trim();
  if (!text) {
    float.hidden = true;
    return;
  }
  float.textContent = text;
  float.hidden = false;
  float.classList.remove("tip-float--below");

  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  const gap = 6;
  // Measure after unhide
  const tipW = float.offsetWidth;
  const tipH = float.offsetHeight;

  let left = rect.left + rect.width / 2 - tipW / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tipW - pad));

  const preferAbove = rect.top >= tipH + gap + pad;
  let top: number;
  if (preferAbove) {
    top = rect.top - tipH - gap;
  } else {
    top = rect.bottom + gap;
    float.classList.add("tip-float--below");
  }
  top = Math.max(pad, Math.min(top, window.innerHeight - tipH - pad));

  float.style.left = `${Math.round(left)}px`;
  float.style.top = `${Math.round(top)}px`;
}

function bindTableTips(root: ParentNode): void {
  const float = ensureTipFloat();
  const tips = root.querySelectorAll<HTMLElement>(".table-wrap .tip[data-tip]");

  for (const tip of tips) {
    if (tip.dataset.tipBound === "1") continue;
    tip.dataset.tipBound = "1";

    const show = (): void => placeTipFloat(tip, float);
    const hide = (): void => {
      float.hidden = true;
    };

    tip.addEventListener("mouseenter", show);
    tip.addEventListener("mouseleave", hide);
    tip.addEventListener("focus", show);
    tip.addEventListener("blur", hide);
  }
}

export function initLeaderboard(root: ParentNode): void {
  bindGlobalMenuDismissal();
  bindGlobalRowExpand();
  for (const table of root.querySelectorAll<HTMLTableElement>(
    "table.table[data-interactive='true']",
  )) {
    initializeTable(table);
  }
  bindTableTips(root);
}
