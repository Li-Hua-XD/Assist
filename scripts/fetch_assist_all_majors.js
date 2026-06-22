const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE_URL = "https://assist.org";
const ACADEMIC_YEAR_ID = 76;
const ACADEMIC_YEAR_LABEL = "2025-2026";
const CATEGORY_CODE = "major";
const EXPECTED_CCC_COUNT = 121;
const EXPECTED_UC_COUNT = 9;
const CONCURRENCY = 4;
const START_DELAY_MS = 120;
const MAX_ATTEMPTS = 4;

const outputRoot = path.resolve(process.cwd(), "assist_2025_2026_all_majors");
const jsonDir = path.join(outputRoot, "json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          bodyBuffer,
          bodyText: bodyBuffer.toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error(`Request timed out: ${url}`));
    });
  });
}

function extractSessionCookies(setCookieHeaders) {
  const cookies = (setCookieHeaders || []).map((cookie) => cookie.split(";")[0]);
  const xsrfCookie = cookies.find((cookie) => cookie.startsWith("X-XSRF-TOKEN="));
  if (!xsrfCookie) {
    throw new Error("Could not find X-XSRF-TOKEN cookie from ASSIST home page.");
  }
  const token = decodeURIComponent(xsrfCookie.slice("X-XSRF-TOKEN=".length));
  return {
    cookieHeader: cookies.join("; "),
    token,
  };
}

async function createAssistSession() {
  const home = await request(`${BASE_URL}/`, {
    "User-Agent": "Mozilla/5.0",
    Accept: "text/html,application/xhtml+xml",
  });
  if (home.statusCode !== 200) {
    throw new Error(`ASSIST home page returned ${home.statusCode}`);
  }
  const { cookieHeader, token } = extractSessionCookies(home.headers["set-cookie"]);
  return {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Referer: `${BASE_URL}/`,
      Cookie: cookieHeader,
      "X-XSRF-TOKEN": token,
    },
  };
}

async function getJson(session, apiPath, params = {}) {
  const url = new URL(apiPath, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await request(url.toString(), session.headers);
  if (response.statusCode !== 200) {
    const message = response.bodyText.slice(0, 500).replace(/\s+/g, " ");
    const error = new Error(`GET ${url.pathname}${url.search} returned ${response.statusCode}: ${message}`);
    error.statusCode = response.statusCode;
    error.responseBytes = response.bodyBuffer.length;
    throw error;
  }
  return {
    data: JSON.parse(response.bodyText),
    statusCode: response.statusCode,
    responseBytes: response.bodyBuffer.length,
    url: url.toString(),
  };
}

function expandInstitutionNames(institutions, category) {
  const rows = [];
  for (const institution of institutions.filter((item) => item.category === category)) {
    for (const name of institution.names || []) {
      if (name.hideInList) continue;
      rows.push({
        name: name.name,
        sourceInstitutionId: institution.id,
        effectiveInstitutionId: name.alternateInstitutionId || institution.id,
        code: String(institution.code || "").trim(),
        fromYear: name.fromYear || null,
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function buildTasks(cccs, ucs) {
  const usedPaths = new Set();
  const tasks = [];
  for (const ccc of cccs) {
    for (const uc of ucs) {
      const baseSlug = `${slugify(ccc.name)}__to__${slugify(uc.name)}`;
      let fileName = `${baseSlug}.json`;
      if (usedPaths.has(fileName)) {
        fileName = `${baseSlug}__${ccc.effectiveInstitutionId}_${uc.effectiveInstitutionId}.json`;
      }
      usedPaths.add(fileName);
      tasks.push({
        ccc,
        uc,
        relativeFilePath: path.join("json", fileName).replace(/\\/g, "/"),
        filePath: path.join(jsonDir, fileName),
      });
    }
  }
  return tasks;
}

async function fetchAgreement(session, task) {
  const params = {
    receivingInstitutionId: task.uc.effectiveInstitutionId,
    sendingInstitutionId: task.ccc.effectiveInstitutionId,
    academicYearId: ACADEMIC_YEAR_ID,
    categoryCode: CATEGORY_CODE,
  };

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await getJson(session, "/api/agreements", params);
      const reports = Array.isArray(result.data.reports) ? result.data.reports : [];
      const allReports = Array.isArray(result.data.allReports) ? result.data.allReports : [];
      const payload = {
        fetchedAt: nowIso(),
        source: "assist.org",
        academicYearId: ACADEMIC_YEAR_ID,
        academicYear: ACADEMIC_YEAR_LABEL,
        categoryCode: CATEGORY_CODE,
        cccName: task.ccc.name,
        cccId: task.ccc.effectiveInstitutionId,
        cccSourceInstitutionId: task.ccc.sourceInstitutionId,
        cccCode: task.ccc.code,
        ucName: task.uc.name,
        ucId: task.uc.effectiveInstitutionId,
        ucSourceInstitutionId: task.uc.sourceInstitutionId,
        ucCode: task.uc.code,
        requestUrl: result.url,
        responseBytes: result.responseBytes,
        data: result.data,
      };
      fs.writeFileSync(task.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      return {
        ccc_name: task.ccc.name,
        ccc_id: task.ccc.effectiveInstitutionId,
        ccc_source_institution_id: task.ccc.sourceInstitutionId,
        uc_name: task.uc.name,
        uc_id: task.uc.effectiveInstitutionId,
        uc_source_institution_id: task.uc.sourceInstitutionId,
        academic_year: ACADEMIC_YEAR_LABEL,
        academic_year_id: ACADEMIC_YEAR_ID,
        report_count: reports.length,
        all_report_count: allReports.length,
        status: reports.length > 0 || allReports.length > 0 ? "success" : "empty",
        http_status: result.statusCode,
        response_bytes: result.responseBytes,
        file_path: task.relativeFilePath,
        error: "",
      };
    } catch (error) {
      lastError = error;
      const retryable = error.statusCode === 429 || (error.statusCode >= 500 && error.statusCode <= 599) || !error.statusCode;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(1000 * attempt * attempt);
    }
  }

  return {
    ccc_name: task.ccc.name,
    ccc_id: task.ccc.effectiveInstitutionId,
    ccc_source_institution_id: task.ccc.sourceInstitutionId,
    uc_name: task.uc.name,
    uc_id: task.uc.effectiveInstitutionId,
    uc_source_institution_id: task.uc.sourceInstitutionId,
    academic_year: ACADEMIC_YEAR_LABEL,
    academic_year_id: ACADEMIC_YEAR_ID,
    report_count: 0,
    all_report_count: 0,
    status: "failed",
    http_status: lastError && lastError.statusCode ? lastError.statusCode : "",
    response_bytes: lastError && lastError.responseBytes ? lastError.responseBytes : "",
    file_path: "",
    error: lastError ? lastError.message : "Unknown error",
  };
}

async function runWithConcurrency(tasks, worker) {
  const rows = new Array(tasks.length);
  let nextIndex = 0;
  let completed = 0;
  let lastProgressAt = Date.now();

  async function runWorker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      await sleep(START_DELAY_MS);
      rows[index] = await worker(tasks[index], index);
      completed += 1;
      const now = Date.now();
      if (completed === tasks.length || now - lastProgressAt > 10000) {
        lastProgressAt = now;
        const failed = rows.filter((row) => row && row.status === "failed").length;
        const empty = rows.filter((row) => row && row.status === "empty").length;
        console.log(`[${nowIso()}] Completed ${completed}/${tasks.length}; empty=${empty}; failed=${failed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorker()));
  return rows;
}

function writeCsv(rows) {
  const columns = [
    "ccc_name",
    "ccc_id",
    "ccc_source_institution_id",
    "uc_name",
    "uc_id",
    "uc_source_institution_id",
    "academic_year",
    "academic_year_id",
    "report_count",
    "all_report_count",
    "status",
    "http_status",
    "response_bytes",
    "file_path",
    "error",
  ];
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
  fs.writeFileSync(path.join(outputRoot, "index.csv"), `${csv}\n`, "utf8");
}

function writeSummary(cccs, ucs, rows, startedAt) {
  const summary = {
    source: "assist.org",
    startedAt,
    completedAt: nowIso(),
    academicYear: ACADEMIC_YEAR_LABEL,
    academicYearId: ACADEMIC_YEAR_ID,
    categoryCode: CATEGORY_CODE,
    cccCount: cccs.length,
    ucCount: ucs.length,
    totalExpectedPairs: cccs.length * ucs.length,
    totalRows: rows.length,
    successCount: rows.filter((row) => row.status === "success").length,
    emptyCount: rows.filter((row) => row.status === "empty").length,
    failureCount: rows.filter((row) => row.status === "failed").length,
    totalReportCount: rows.reduce((sum, row) => sum + Number(row.report_count || 0), 0),
    totalAllReportCount: rows.reduce((sum, row) => sum + Number(row.all_report_count || 0), 0),
    cccs,
    ucs,
  };
  fs.writeFileSync(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

async function main() {
  const startedAt = nowIso();
  fs.mkdirSync(jsonDir, { recursive: true });

  console.log(`[${nowIso()}] Creating ASSIST session`);
  const session = await createAssistSession();

  console.log(`[${nowIso()}] Loading institutions`);
  const institutionsResult = await getJson(session, "/api/institutions");
  const cccs = expandInstitutionNames(institutionsResult.data, 2);
  const ucs = expandInstitutionNames(institutionsResult.data, 1);
  const tasks = buildTasks(cccs, ucs);

  console.log(`[${nowIso()}] CCC=${cccs.length}; UC=${ucs.length}; pairs=${tasks.length}`);
  if (cccs.length !== EXPECTED_CCC_COUNT) {
    throw new Error(`Expected ${EXPECTED_CCC_COUNT} CCC menu options, found ${cccs.length}`);
  }
  if (ucs.length !== EXPECTED_UC_COUNT) {
    throw new Error(`Expected ${EXPECTED_UC_COUNT} UC menu options, found ${ucs.length}`);
  }
  if (tasks.length !== EXPECTED_CCC_COUNT * EXPECTED_UC_COUNT) {
    throw new Error(`Expected ${EXPECTED_CCC_COUNT * EXPECTED_UC_COUNT} pairs, found ${tasks.length}`);
  }

  const allan = cccs.find((ccc) => ccc.name === "Allan Hancock College");
  const berkeley = ucs.find((uc) => uc.name === "University of California, Berkeley");
  if (!allan || !berkeley) throw new Error("Could not find sample Allan Hancock College or UC Berkeley.");
  const sample = await getJson(session, "/api/agreements", {
    receivingInstitutionId: berkeley.effectiveInstitutionId,
    sendingInstitutionId: allan.effectiveInstitutionId,
    academicYearId: ACADEMIC_YEAR_ID,
    categoryCode: CATEGORY_CODE,
  });
  if (!sample.data.reports || sample.data.reports.length === 0) {
    throw new Error("Sample Allan Hancock College to UC Berkeley returned no major reports.");
  }
  console.log(`[${nowIso()}] Sample check passed with ${sample.data.reports.length} reports`);

  const rows = await runWithConcurrency(tasks, (task) => fetchAgreement(session, task));
  writeCsv(rows);
  const summary = writeSummary(cccs, ucs, rows, startedAt);

  const jsonFileCount = fs.readdirSync(jsonDir).filter((name) => name.endsWith(".json")).length;
  if (jsonFileCount + summary.failureCount !== tasks.length) {
    throw new Error(`Output validation failed: json files ${jsonFileCount} + failures ${summary.failureCount} != ${tasks.length}`);
  }

  console.log(`[${nowIso()}] Done`);
  console.log(JSON.stringify({
    outputRoot,
    jsonFileCount,
    successCount: summary.successCount,
    emptyCount: summary.emptyCount,
    failureCount: summary.failureCount,
    totalReportCount: summary.totalReportCount,
  }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
