import sql from 'mssql';
import { readFile } from 'node:fs/promises';

const templates = Object.fromEntries(await Promise.all(['joins', 'columns', 'health','quality-source','quality-groups','quality-list','quality-details'].map(async name => [name, await readFile(new URL(`./sql/${name}.sql`, import.meta.url), 'utf8')])));
let poolPromise;
async function pool() {
  if (!poolPromise) poolPromise = (async () => {
    const file = process.env.SQLSERVER_PASSWORD_FILE;
    if (!file || process.env.SQLSERVER_HOST !== '192.168.19.222') throw new Error('Database configuration unavailable');
    const password = await readFile(file, 'utf8');
    if (!password) throw new Error('Database credential unavailable');
    const connection = new sql.ConnectionPool({
      server: '192.168.19.222', port: 1433, database: 'UFDATA_333_2025', user: 'va2', password,
      connectionTimeout: 5000, requestTimeout: 12000,
      pool: {max: 3, min: 0, idleTimeoutMillis: 30000},
      options: {encrypt: true, trustServerCertificate: true, appName: 'Infomat-U8-StockOrder-Query-Docker', useUTC: true}
    });
    connection.on('error', () => {});
    return connection.connect();
  })().catch(error => { poolPromise = undefined; throw error; });
  return poolPromise;
}
const textConditions = {
  voucher: "m.VoucherCode LIKE @voucher ESCAPE N'~'",
  productionNumber: "(m.SourceProductionNumber LIKE @productionNumber ESCAPE N'~' OR m.AttributedProductionNumber LIKE @productionNumber ESCAPE N'~' OR m.SalesProductionNumber LIKE @productionNumber ESCAPE N'~')",
  productionOrder: "(m.SourceProductionOrderCode LIKE @productionOrder ESCAPE N'~' OR m.ProductionOrderCode LIKE @productionOrder ESCAPE N'~')",
  salesOrder: "m.SalesOrderCode LIKE @salesOrder ESCAPE N'~'",
  inventory: "m.InventoryCode LIKE @inventory ESCAPE N'~'",
  qualityNumber: "n.QualityNumber LIKE @qualityNumber ESCAPE N'~'",
  partNumber: "n.U8PartNumber LIKE @partNumber ESCAPE N'~'"
};
export async function queryDatabase(operation, filters = {}) {
  const request = (await pool()).request();
  if (operation === 'health') {
    const value = (await request.query(templates.health)).recordset[0];
    if (value.DatabaseName !== 'UFDATA_333_2025' || value.LoginName !== 'va2' || !value.CaptureColumnLength || !value.RefreshColumnLength) throw new Error('Database contract mismatch');
    return {ok: true, database: value.DatabaseName, databaseUser: 'va2', timeZone: 'UTC+8', beijingNow: value.BeijingNow, mappingCount: Number(value.MappingCount), readOnlyService: true};
  }
  if (['quality-uniqueness','quality-uniqueness-details'].includes(operation)) {
    const details = operation === 'quality-uniqueness-details';
    for (const [key,param] of [['drawing','Drawing'],['qualityNumber','QualityNumber']]) {
      const text = filters[key] || null;
      request.input(param,sql.NVarChar(250),details ? text : text ? `%${text.replace(/[~%_\[]/g,c=>`~${c}`)}%` : null);
    }
    if (!details) request.input('CheckStatus',sql.VarChar(20),filters.status);
    request.input('Offset',sql.Int,(filters.page-1)*filters.pageSize);request.input('PageSize',sql.Int,filters.pageSize);
    const text = details ? templates['quality-details'].replaceAll('/*QUALITY_SOURCE*/',templates['quality-source'])
      : templates['quality-list'].replaceAll('/*QUALITY_GROUPS*/',templates['quality-source']+templates['quality-groups']);
    const result = await request.query(text);const value=result.recordsets[0][0];
    const common={ok:true,rows:result.recordsets[1],page:filters.page,pageSize:filters.pageSize,checkedAtUtc8:value.CheckedAtUtc8,timeZone:'UTC+8'};
    return details ? {...common,total:Number(value.Total)} : {...common,totals:{total:Number(value.Total),duplicates:value.Duplicates,unique:value.UniqueGroups,pending:value.Pending}};
  }
  if (operation !== 'list') throw new Error('Unsupported database operation');
  const conditions = [];
  for (const [key, condition] of Object.entries(textConditions)) if (filters[key]) {
    const escaped = filters[key].replace(/[~%_\[]/g, character => `~${character}`);
    request.input(key, sql.NVarChar(250), `%${escaped}%`); conditions.push(condition);
  }
  for (const [key, column] of [['type','m.VoucherType'],['status','m.ResolutionStatus'],['qualityCheck','qc.QualityNumberCheck']]) if (filters[key]) {
    request.input(key, sql.VarChar(30), filters[key]); conditions.push(`${column} = @${key}`);
  }
  if (filters.difference) conditions.push(({different:'m.ProductionNumberDiffers=1',same:'m.ProductionNumberDiffers=0',unknown:'m.ProductionNumberDiffers IS NULL'})[filters.difference]);
  for (const key of ['dateFrom', 'dateTo']) if (filters[key]) {
    request.input(key, sql.DateTime, new Date(`${filters[key]}T00:00:00Z`));
    conditions.push(key === 'dateFrom' ? 'm.VoucherDate >= @dateFrom' : 'm.VoucherDate < DATEADD(DAY,1,@dateTo)');
  }
  request.input('Offset', sql.Int, (filters.page - 1) * filters.pageSize);
  request.input('PageSize', sql.Int, filters.pageSize);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await request.query(`
SELECT COUNT_BIG(*) AS Total,
 COALESCE(SUM(CASE WHEN m.VoucherType='10' THEN 1 ELSE 0 END),0) AS Receipts,
 COALESCE(SUM(CASE WHEN m.VoucherType='11' THEN 1 ELSE 0 END),0) AS Issues,
 COALESCE(SUM(CASE WHEN m.ResolutionStatus='pending' THEN 1 ELSE 0 END),0) AS Pending,
 CONVERT(varchar(23),DATEADD(HOUR,8,SYSUTCDATETIME()),121) AS CheckedAtUtc8
FROM dbo.ext_StockOrderAttribution AS m ${templates.joins} ${where};
${templates.columns}
FROM dbo.ext_StockOrderAttribution AS m ${templates.joins}
LEFT JOIN dbo.Inventory AS i ON i.cInvCode=m.InventoryCode
LEFT JOIN dbo.Inventory AS pi ON pi.cInvCode=md.InvCode
${where}
ORDER BY m.CapturedAtUtc8 DESC,m.VoucherType,m.DetailID DESC
OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY`);
  const value = result.recordsets[0][0];
  return {ok:true, rows:result.recordsets[1], totals:{total:Number(value.Total),receipts:value.Receipts,issues:value.Issues,pending:value.Pending},page:filters.page,pageSize:filters.pageSize,timeZone:'UTC+8',checkedAtUtc8:value.CheckedAtUtc8};
}
export async function closeDatabase() { if (poolPromise) await (await poolPromise).close(); }
