import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workDir = "E:/CA001/Infomat/.tmp/ca_inventory_xlsx_20260831";
const outputDir = "E:/CA001/Infomat/outputs/ca_inventory_export_20260831";
const outputPath = `${outputDir}/Ca_Inventory_明细导出.xlsx`;

const queryScript = String.raw`
$ErrorActionPreference = 'Stop'
function Get-UserEnv([string]$name) { [Environment]::GetEnvironmentVariable($name, 'User') }
$hostName = Get-UserEnv 'SQLSERVER_HOST'
$port = Get-UserEnv 'SQLSERVER_PORT'
$databaseName = Get-UserEnv 'SQLSERVER_DATABASE'
$userName = Get-UserEnv 'SQLSERVER_USER'
$password = Get-UserEnv 'SQLSERVER_PASSWORD'
$encrypt = Get-UserEnv 'SQLSERVER_ENCRYPT'
$trustCertificate = Get-UserEnv 'SQLSERVER_TRUST_SERVER_CERTIFICATE'
if ([string]::IsNullOrWhiteSpace($hostName) -or [string]::IsNullOrWhiteSpace($databaseName) -or [string]::IsNullOrWhiteSpace($userName) -or [string]::IsNullOrWhiteSpace($password)) { throw 'Required SQL Server user environment variables are missing.' }
$connectionString = "Server=$hostName,$port;Initial Catalog=$databaseName;User ID=$userName;Password=$password;Encrypt=$encrypt;TrustServerCertificate=$trustCertificate;Connect Timeout=20;"
$connection = New-Object System.Data.SqlClient.SqlConnection $connectionString
try {
  $connection.Open()
  $schemaCommand = $connection.CreateCommand()
  $schemaCommand.CommandText = @'
SELECT c.name, TYPE_NAME(c.user_type_id) AS typeName, c.column_id
FROM sys.columns AS c
WHERE c.object_id = OBJECT_ID(N'dbo.Ca_Inventory')
ORDER BY c.column_id;
'@
  $schemaReader = $schemaCommand.ExecuteReader()
  $columns = @()
  while ($schemaReader.Read()) {
    $columns += [pscustomobject]@{ name = [string]$schemaReader['name']; typeName = [string]$schemaReader['typeName']; ordinal = [int]$schemaReader['column_id'] }
  }
  $schemaReader.Close()
  if ($columns.Count -eq 0) { throw 'dbo.Ca_Inventory was not found.' }
  $dataCommand = $connection.CreateCommand()
  $dataCommand.CommandText = 'SELECT * FROM dbo.Ca_Inventory ORDER BY cInvCode;'
  $dataReader = $dataCommand.ExecuteReader()
  $rows = New-Object System.Collections.Generic.List[object]
  while ($dataReader.Read()) {
    $record = [ordered]@{}
    foreach ($column in $columns) {
      $value = $dataReader[$column.name]
      if ($value -is [System.DBNull]) { $record[$column.name] = $null }
      elseif ($value -is [datetime]) { $record[$column.name] = $value.ToString('o') }
      else { $record[$column.name] = $value }
    }
    $rows.Add([pscustomobject]$record)
  }
  $dataReader.Close()
  [pscustomobject]@{
    exportedAt = [datetime]::Now.ToString('yyyy-MM-dd HH:mm:ss')
    columns = $columns
    rows = $rows
  } | ConvertTo-Json -Depth 6 -Compress
}
finally {
  if ($null -ne $connection) { $connection.Dispose() }
}
`;

function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`SQL Server extraction failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function asCellValue(value, typeName) {
  if (value === null || value === undefined) return null;
  if (["datetime", "smalldatetime", "date", "datetime2"].includes(String(typeName).toLowerCase())) {
    return new Date(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function columnWidth(columnName) {
  if (columnName === "cInvName") return 32;
  if (columnName === "cInvStd") return 28;
  if (columnName === "cInvCode") return 18;
  if (columnName === "cInvCName") return 24;
  if (columnName === "cInvCCode") return 14;
  if (columnName === "cInvM_Unit" || columnName === "cAssUnit") return 14;
  if (/^i|^caFlag|^bProxy/.test(columnName)) return 14;
  if (/^cInvDefine/.test(columnName)) return 18;
  if (/^Free/.test(columnName)) return 14;
  return 16;
}

function columnLabel(indexZeroBased) {
  let value = indexZeroBased + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

const payload = JSON.parse(runPowerShell(queryScript));
const allColumns = payload.columns;
const sourceRows = payload.rows;
const retainedColumns = allColumns.filter((column) => sourceRows.some((row) => {
  const value = row[column.name];
  return value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "");
}));
const omittedColumns = allColumns.filter((column) => !retainedColumns.some((retained) => retained.name === column.name));
const matrix = sourceRows.map((row) => retainedColumns.map((column) => asCellValue(row[column.name], column.typeName)));

const workbook = Workbook.create();
const infoSheet = workbook.worksheets.add("导出说明");
const dataSheet = workbook.worksheets.add("Ca_Inventory");
infoSheet.showGridLines = false;
dataSheet.showGridLines = false;

infoSheet.getRange("A1:F1").merge();
infoSheet.getRange("A1").values = [["Ca_Inventory 明细导出说明"]];
infoSheet.getRange("A1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF", size: 16 },
  horizontalAlignment: "left",
  verticalAlignment: "center",
};
infoSheet.getRange("A1:F1").format.rowHeight = 28;
infoSheet.getRange("A3:B8").values = [
  ["来源表", "UFDATA_333_2025.dbo.Ca_Inventory"],
  ["导出时间", payload.exportedAt],
  ["数据行数", sourceRows.length],
  ["源字段数", allColumns.length],
  ["保留字段数", retainedColumns.length],
  ["省略字段数", omittedColumns.length],
];
infoSheet.getRange("A3:A8").format = { fill: "#D9EAF7", font: { bold: true, color: "#1F1F1F" } };
infoSheet.getRange("A3:B8").format.borders = { preset: "outside", style: "thin", color: "#9FBAD0" };
infoSheet.getRange("B5:B8").format.numberFormat = "#,##0";
infoSheet.getRange("A10:C10").values = [["保留字段", "SQL Server 数据类型", "说明"]];
infoSheet.getRange("E10:F10").values = [["省略字段", "SQL Server 数据类型"]];
infoSheet.getRange("A10:C10").format = { fill: "#5B9BD5", font: { bold: true, color: "#FFFFFF" } };
infoSheet.getRange("E10:F10").format = { fill: "#7F8C8D", font: { bold: true, color: "#FFFFFF" } };
infoSheet.getRangeByIndexes(10, 0, retainedColumns.length, 3).values = retainedColumns.map((column) => [
  column.name,
  column.typeName,
  "本次导出中至少存在一条非空值",
]);
if (omittedColumns.length > 0) {
  infoSheet.getRangeByIndexes(10, 4, omittedColumns.length, 2).values = omittedColumns.map((column) => [column.name, column.typeName]);
}
infoSheet.getRange("A10:C10").format.borders = { preset: "outside", style: "thin", color: "#9FBAD0" };
infoSheet.getRangeByIndexes(10, 0, retainedColumns.length, 3).format.borders = { preset: "inside", style: "thin", color: "#D9E2F3" };
if (omittedColumns.length > 0) {
  infoSheet.getRange("E10:F10").format.borders = { preset: "outside", style: "thin", color: "#B7B7B7" };
  infoSheet.getRangeByIndexes(10, 4, omittedColumns.length, 2).format.borders = { preset: "inside", style: "thin", color: "#E7E6E6" };
}
infoSheet.getRange("A10:C200").format.wrapText = true;
infoSheet.getRange("A1").format.columnWidth = 24;
infoSheet.getRange("B1").format.columnWidth = 30;
infoSheet.getRange("C1").format.columnWidth = 34;
infoSheet.getRange("D1").format.columnWidth = 3;
infoSheet.getRange("E1").format.columnWidth = 24;
infoSheet.getRange("F1").format.columnWidth = 22;
infoSheet.freezePanes.freezeRows(1);

dataSheet.getRangeByIndexes(0, 0, 1, retainedColumns.length).values = [retainedColumns.map((column) => column.name)];
dataSheet.getRangeByIndexes(1, 0, matrix.length, retainedColumns.length).values = matrix;
const fullRange = dataSheet.getRangeByIndexes(0, 0, matrix.length + 1, retainedColumns.length);
dataSheet.getRangeByIndexes(0, 0, 1, retainedColumns.length).format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
dataSheet.getRangeByIndexes(0, 0, 1, retainedColumns.length).format.rowHeight = 28;
fullRange.format.font = { name: "Aptos", size: 10 };
fullRange.format.verticalAlignment = "center";
for (let index = 0; index < retainedColumns.length; index += 1) {
  const column = retainedColumns[index];
  const columnRange = dataSheet.getRangeByIndexes(1, index, matrix.length, 1);
  dataSheet.getRangeByIndexes(0, index, matrix.length + 1, 1).format.columnWidth = columnWidth(column.name);
  if (["int", "bigint", "smallint", "tinyint"].includes(String(column.typeName).toLowerCase())) {
    columnRange.format.numberFormat = "#,##0";
    columnRange.format.horizontalAlignment = "right";
  } else if (["float", "decimal", "numeric", "money", "smallmoney", "real"].includes(String(column.typeName).toLowerCase())) {
    columnRange.format.numberFormat = "#,##0.########";
    columnRange.format.horizontalAlignment = "right";
  } else if (["datetime", "smalldatetime", "date", "datetime2"].includes(String(column.typeName).toLowerCase())) {
    columnRange.format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  } else {
    columnRange.format.wrapText = true;
  }
}
dataSheet.freezePanes.freezeRows(1);
const dataTable = dataSheet.tables.add(`A1:${columnLabel(retainedColumns.length - 1)}${matrix.length + 1}`, true, "CaInventoryData");
dataTable.style = "TableStyleMedium2";
dataTable.showFilterButton = true;

const workbookSummary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 4000,
  tableMaxRows: 3,
  tableMaxCols: 8,
  tableMaxCellChars: 60,
});
const formulaSummary = await workbook.inspect({
  kind: "formula",
  maxChars: 1200,
  options: { maxResults: 30 },
});
await fs.mkdir(workDir, { recursive: true });
for (const sheetName of ["导出说明", "Ca_Inventory"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: sheetName === "Ca_Inventory" ? 0.05 : 1, format: "png" });
  await fs.writeFile(`${workDir}/${sheetName}_preview.png`, new Uint8Array(await preview.arrayBuffer()));
}
await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  rowCount: sourceRows.length,
  sourceFieldCount: allColumns.length,
  retainedFieldCount: retainedColumns.length,
  omittedFieldCount: omittedColumns.length,
  omittedFields: omittedColumns.map((column) => column.name),
  workbookInspect: workbookSummary,
  formulaInspect: formulaSummary,
}, null, 2));
