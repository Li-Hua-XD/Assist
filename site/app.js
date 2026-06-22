const state = {
  rows: [],
  filtered: [],
  majorIndex: null,
  majorRows: [],
  majorFiltered: [],
  summary: null,
};

const el = {
  majorSearch: document.querySelector("#major-search"),
  ccc: document.querySelector("#ccc-filter"),
  uc: document.querySelector("#uc-filter"),
  status: document.querySelector("#status-filter"),
  reset: document.querySelector("#reset"),
  allMajorsLink: document.querySelector("#all-majors-link"),
  rows: document.querySelector("#rows"),
  majorRows: document.querySelector("#major-rows"),
  template: document.querySelector("#row-template"),
  majorTemplate: document.querySelector("#major-row-template"),
  resultCount: document.querySelector("#result-count"),
  majorResultCount: document.querySelector("#major-result-count"),
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

function hydrateMajorRows(index) {
  return index.rows.map(([majorId, cccId, ucId, fileId, keyId]) => {
    const major = index.majors[majorId];
    const [ccc, cccInstitutionId] = index.cccs[cccId];
    const [uc, ucInstitutionId] = index.ucs[ucId];
    const keySuffix = index.keySuffixes[keyId];
    return {
      major,
      ccc,
      cccInstitutionId,
      uc,
      ucInstitutionId,
      file: index.files[fileId],
      assistKey: `76/${cccInstitutionId}/to/${ucInstitutionId}/Major/${keySuffix}`,
      searchText: `${major} ${ccc} ${uc}`.toLowerCase(),
    };
  });
}

function assistUrl(key) {
  const parts = key.split("/");
  const cccId = parts[1];
  const ucId = parts[3];
  return `https://assist.org/transfer/results?year=76&institution=${cccId}&agreement=${ucId}&agreementType=to&viewAgreementsOptions=true&view=agreement&viewBy=major&viewSendingAgreements=false&viewByKey=${encodeURIComponent(key)}`;
}

function updateAllMajorsLink() {
  if (!el.ccc.value || !el.uc.value || !state.majorFiltered.length) {
    el.allMajorsLink.href = "#";
    el.allMajorsLink.classList.add("disabled");
    el.allMajorsLink.setAttribute("aria-disabled", "true");
    return;
  }

  const first = state.majorFiltered[0];
  const key = `76/${first.cccInstitutionId}/to/${first.ucInstitutionId}/AllMajors`;
  el.allMajorsLink.href = assistUrl(key);
  el.allMajorsLink.classList.remove("disabled");
  el.allMajorsLink.removeAttribute("aria-disabled");
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
  const query = el.majorSearch.value.trim().toLowerCase();
  const ccc = el.ccc.value;
  const uc = el.uc.value;
  const status = el.status.value;

  state.filtered = state.rows.filter((row) => {
    return (!ccc || row.ccc_name === ccc)
      && (!uc || row.uc_name === uc)
      && (!status || row.status === status);
  });

  state.majorFiltered = state.majorRows.filter((row) => {
    return (!query || row.searchText.includes(query))
      && (!ccc || row.ccc === ccc)
      && (!uc || row.uc === uc);
  });

  updateAllMajorsLink();
  renderMajorRows(Boolean(query || ccc || uc));
  renderRows();
}

function renderMajorRows(showResults) {
  const fragment = document.createDocumentFragment();
  const rows = showResults ? state.majorFiltered : [];
  const limit = 500;

  for (const row of rows.slice(0, limit)) {
    const clone = el.majorTemplate.content.firstElementChild.cloneNode(true);
    const cells = clone.querySelectorAll("td");
    cells[0].innerHTML = `<span class="major-name">${row.major}</span>`;
    cells[1].textContent = row.ccc;
    cells[2].textContent = row.uc;
    cells[3].innerHTML = `<a class="json-link" href="${assistUrl(row.assistKey)}" target="_blank" rel="noopener">View prerequisites</a>`;
    cells[4].innerHTML = `<a class="json-link" href="${row.file}">Open JSON</a>`;
    fragment.append(clone);
  }

  el.majorRows.replaceChildren(fragment);
  if (!showResults) {
    el.majorResultCount.textContent = `Choose a CCC and UC to view all majors; optional search narrows ${numberFormat(state.majorRows.length)} major entries`;
    return;
  }

  const suffix = rows.length > limit ? `, showing first ${limit}` : "";
  el.majorResultCount.textContent = `${numberFormat(rows.length)} major matches${suffix}`;
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
  const [summary, csv, majorIndex] = await Promise.all([
    fetch("assist_2025_2026_all_majors/summary.json").then((response) => response.json()),
    fetch("assist_2025_2026_all_majors/index.csv").then((response) => response.text()),
    fetch("site/major-search-index.json").then((response) => response.json()),
  ]);

  state.summary = summary;
  state.rows = parseCsv(csv);
  state.filtered = state.rows;
  state.majorIndex = majorIndex;
  state.majorRows = hydrateMajorRows(majorIndex);
  state.majorFiltered = state.majorRows;

  updateMetrics();
  fillSelect(el.ccc, uniqueSorted(state.rows, "ccc_name"));
  fillSelect(el.uc, uniqueSorted(state.rows, "uc_name"));
  renderMajorRows(false);
  renderRows();
}

el.majorSearch.addEventListener("input", applyFilters);
el.ccc.addEventListener("change", applyFilters);
el.uc.addEventListener("change", applyFilters);
el.status.addEventListener("change", applyFilters);
el.reset.addEventListener("click", () => {
  el.majorSearch.value = "";
  el.ccc.value = "";
  el.uc.value = "";
  el.status.value = "";
  applyFilters();
});

init().catch((error) => {
  el.majorResultCount.textContent = `Could not load index data: ${error.message}`;
});
