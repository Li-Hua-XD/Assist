const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataRoot = path.join(root, "assist_2025_2026_all_majors");
const jsonRoot = path.join(dataRoot, "json");
const outputPath = path.join(root, "site", "major-search-index.json");

function getId(map, values, value) {
  if (!map.has(value)) {
    map.set(value, values.length);
    values.push(value);
  }
  return map.get(value);
}

function main() {
  const majorMap = new Map();
  const cccMap = new Map();
  const ucMap = new Map();
  const fileMap = new Map();
  const majors = [];
  const cccs = [];
  const ucs = [];
  const files = [];
  const keySuffixes = [];
  const keySuffixMap = new Map();
  const rows = [];

  const jsonFiles = fs.readdirSync(jsonRoot)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of jsonFiles) {
    const relativeFile = `assist_2025_2026_all_majors/json/${fileName}`;
    const payload = JSON.parse(fs.readFileSync(path.join(jsonRoot, fileName), "utf8"));
    const reports = payload.data && Array.isArray(payload.data.reports) ? payload.data.reports : [];
    const cccId = getId(cccMap, cccs, `${payload.cccName}|${payload.cccId}`);
    const ucId = getId(ucMap, ucs, `${payload.ucName}|${payload.ucId}`);
    const fileId = getId(fileMap, files, relativeFile);

    for (const report of reports) {
      if (!report || !report.label) continue;
      const majorId = getId(majorMap, majors, report.label.trim());
      const keySuffix = String(report.key || "").split("/").pop();
      const keyId = getId(keySuffixMap, keySuffixes, keySuffix);
      rows.push([majorId, cccId, ucId, fileId, keyId]);
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    academicYear: "2025-2026",
    columns: ["majorId", "cccId", "ucId", "fileId", "keyId"],
    majors,
    cccs: cccs.map((value) => {
      const [name, id] = value.split("|");
      return [name, Number(id)];
    }),
    ucs: ucs.map((value) => {
      const [name, id] = value.split("|");
      return [name, Number(id)];
    }),
    files,
    keySuffixes,
    rows,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result), "utf8");
  console.log(JSON.stringify({
    outputPath,
    majorCount: majors.length,
    cccCount: cccs.length,
    ucCount: ucs.length,
    fileCount: files.length,
    rowCount: rows.length,
    bytes: fs.statSync(outputPath).size,
  }, null, 2));
}

main();
