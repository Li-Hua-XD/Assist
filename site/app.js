const state = {
  rows: [],
  filtered: [],
  summary: null,
};

const el = {
  search: document.querySelector("#search"),
  ccc: document.querySelector("#ccc-filter"),
  uc: document.querySelector("#uc-filter"),
  status: document.querySelector("#status-filter"),
  reset: document.querySelector("#reset"),
  rows: document.querySelector("#rows"),
  template: document.querySelector("#row-template"),
  resultCount: document.querySelector("#result-count"),
  pairs: document.querySelector("#metric-pairs"),
  cccMetric: document.querySelector("#metric-ccc"),
  ucMetric: document.querySelector("#metric-uc"),
  reports: document.querySelector("#metric-reports"),
  empty: document.querySelector("#metric-empty"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows
    .filter((item) => item.length === headers.length)
    .map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
}

function numberFormat(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function uniqueSorted(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function updateMetrics() {
  const summary = state.summary;
  el.pairs.textContent = numberFormat(summary.totalRows);
  el.cccMetric.textContent = numberFormat(summary.cccCount);
  el.ucMetric.textContent = numberFormat(summary.ucCount);
  el.reports.textContent = numberFormat(summary.totalReportCount);
  el.empty.textContent = numberFormat(summary.emptyCount);
}

function applyFilters() {
  const query = el.search.value.trim().toLowerCase();
  const ccc = el.ccc.value;
  const uc = el.uc.value;
  const status = el.status.value;

  state.filtered = state.rows.filter((row) => {
    const haystack = `${row.ccc_name} ${row.uc_name} ${row.status}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (!ccc || row.ccc_name === ccc)
      && (!uc || row.uc_name === uc)
      && (!status || row.status === status);
  });

  renderRows();
}

function renderRows() {
  const fragment = document.createDocumentFragment();
  const rows = state.filtered;
  const limit = 250;

  for (const row of rows.slice(0, limit)) {
    const clone = el.template.content.firstElementChild.cloneNode(true);
    const cells = clone.querySelectorAll("td");
    cells[0].textContent = row.ccc_name;
    cells[1].textContent = row.uc_name;
    cells[2].innerHTML = `<span class="count">${numberFormat(row.report_count)}</span>`;
    cells[3].innerHTML = `<span class="pill ${row.status}">${row.status}</span>`;
    if (row.file_path) {
      const href = `assist_2025_2026_all_majors/${row.file_path}`;
      cells[4].innerHTML = `<a class="json-link" href="${href}">Open JSON</a>`;
    } else {
      cells[4].innerHTML = `<span class="empty-note">No file</span>`;
    }
    fragment.append(clone);
  }

  el.rows.replaceChildren(fragment);
  const suffix = rows.length > limit ? `, showing first ${limit}` : "";
  el.resultCount.textContent = `${numberFormat(rows.length)} of ${numberFormat(state.rows.length)} pairs${suffix}`;
}

async function init() {
  const [summary, csv] = await Promise.all([
    fetch("assist_2025_2026_all_majors/summary.json").then((response) => response.json()),
    fetch("assist_2025_2026_all_majors/index.csv").then((response) => response.text()),
  ]);

  state.summary = summary;
  state.rows = parseCsv(csv);
  state.filtered = state.rows;

  updateMetrics();
  fillSelect(el.ccc, uniqueSorted(state.rows, "ccc_name"));
  fillSelect(el.uc, uniqueSorted(state.rows, "uc_name"));
  renderRows();
}

el.search.addEventListener("input", applyFilters);
el.ccc.addEventListener("change", applyFilters);
el.uc.addEventListener("change", applyFilters);
el.status.addEventListener("change", applyFilters);
el.reset.addEventListener("click", () => {
  el.search.value = "";
  el.ccc.value = "";
  el.uc.value = "";
  el.status.value = "";
  applyFilters();
});

init().catch((error) => {
  el.resultCount.textContent = `Could not load index data: ${error.message}`;
});
