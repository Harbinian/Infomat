# Fixed-source SELECT bridge. Credentials are consumed inside the process only.
# Inputs: reviewed task-local sql file, source ID, local output path. Writes only
# that output and a local audit file; never changes source business data.
param(
 [Parameter(Mandatory=$true)][ValidateSet('u8','kfu','mes')][string]$Source,
 [Parameter(Mandatory=$true)][string]$QueryFile,
 [Parameter(Mandatory=$true)][string]$OutputFile,
 [ValidateRange(5,180)][int]$TimeoutSeconds=90,
 [string]$ExpectedHash
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$queryRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'sql'))+[IO.Path]::DirectorySeparatorChar
$queryPath=[IO.Path]::GetFullPath($QueryFile)
if(-not $queryPath.StartsWith($queryRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Query is outside the reviewed SQL directory'}
$queryText=[IO.File]::ReadAllText($queryPath,[Text.Encoding]::UTF8)
if($ExpectedHash -and (Get-FileHash -LiteralPath $queryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash){throw 'RULE_VERSION_CHANGED'}
if($queryText -notmatch '^\s*(SELECT|WITH)\b' -or $queryText -match '\b(INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|EXEC|EXECUTE|OPENROWSET|OPENQUERY|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC)\b|\bINTO\s'){throw 'Only the reviewed read-only SQL subset is allowed'}
$outputPath=[IO.Path]::GetFullPath($OutputFile)
if(Test-Path -LiteralPath $outputPath){throw 'Output already exists'}
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath))
Add-Type -AssemblyName System.Data,System.Web.Extensions
Add-Type -ReferencedAssemblies System.Data,System.Web.Extensions -TypeDefinition @'
using System;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;
public static class OrderSnapshotBridge {
 public static long Read(string source,string query,string path,int timeout) {
  var b=new SqlConnectionStringBuilder();
  string host,database,user,password;
  if(source=="mes") {
   host=Environment.GetEnvironmentVariable("CESOFT_DB_SERVER",EnvironmentVariableTarget.Machine);
   database=Environment.GetEnvironmentVariable("CESOFT_DB_DATABASE",EnvironmentVariableTarget.Machine);
   user=Environment.GetEnvironmentVariable("CESOFT_DB_USERNAME",EnvironmentVariableTarget.Machine);
   password=Environment.GetEnvironmentVariable("CESOFT_DB_PASSWORD",EnvironmentVariableTarget.Machine);
   if(String.IsNullOrEmpty(host) || !(host=="192.168.19.220" || host.StartsWith("192.168.19.220,") || host.StartsWith("192.168.19.220\\")) || database!="CXSYSYS") throw new InvalidOperationException("SOURCE_TARGET_MISMATCH");
  } else {
   host=Environment.GetEnvironmentVariable("SQLSERVER_HOST",EnvironmentVariableTarget.User);
   database=source=="u8"?"UFDATA_333_2025":"KFU8QZ"; user="va2";
   password=Environment.GetEnvironmentVariable("SQLSERVER_PASSWORD",EnvironmentVariableTarget.User);
   if(host!="192.168.19.222") throw new InvalidOperationException("SOURCE_TARGET_MISMATCH");
  }
  if(String.IsNullOrEmpty(user) || String.IsNullOrEmpty(password)) throw new InvalidOperationException("SOURCE_CONFIGURATION_UNAVAILABLE");
  b.DataSource=host;b.InitialCatalog=database;b.UserID=user;b.Password=password;
  b.ConnectTimeout=8;b.Encrypt=true;b.TrustServerCertificate=true;
  b.ApplicationIntent=ApplicationIntent.ReadOnly;b.ApplicationName="Infomat-Order-Reconciliation-9998-SELECT";
  long count=0;var json=new JavaScriptSerializer();json.MaxJsonLength=Int32.MaxValue;
  using(var connection=new SqlConnection(b.ConnectionString)) {
   connection.Open();
   using(var setup=connection.CreateCommand()){setup.CommandText="SET LOCK_TIMEOUT 5000";setup.ExecuteNonQuery();}
   using(var command=connection.CreateCommand()) {
    command.CommandText=query;command.CommandTimeout=timeout;
    using(var reader=command.ExecuteReader(CommandBehavior.SequentialAccess))
    using(var writer=new StreamWriter(path,false,new UTF8Encoding(false))) {
     while(reader.Read()) {
      var row=new Dictionary<string,object>();
      for(int i=0;i<reader.FieldCount;i++) {
       object v=reader.IsDBNull(i)?null:reader.GetValue(i);
       if(v is DateTime) v=((DateTime)v).ToString("yyyy-MM-ddTHH:mm:ss.fffffff",CultureInfo.InvariantCulture);
       else if(v is byte[]) v=Convert.ToBase64String((byte[])v);
       else if(v!=null && !(v is string)) v=Convert.ToString(v,CultureInfo.InvariantCulture);
       row.Add(reader.GetName(i),v);
      }
      writer.WriteLine(json.Serialize(row));count++;
     }
     if(reader.NextResult()) throw new InvalidOperationException("MULTIPLE_RESULT_SETS_NOT_ALLOWED");
    }
   }
  }
  return count;
 }
}
'@
$started=[DateTimeOffset]::UtcNow.ToString('o')
$audit=[ordered]@{source=$Source;startedAt=$started;finishedAt=$null;querySha256=(Get-FileHash -LiteralPath $queryPath -Algorithm SHA256).Hash.ToLowerInvariant();queryFile=[IO.Path]::GetFileName($queryPath);status='running';count=0}
try {
 $audit.count=[OrderSnapshotBridge]::Read($Source,$queryText,$outputPath,$TimeoutSeconds)
 $audit.status='succeeded'
 $audit.sha256=(Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
} catch {
 $failure=$_.Exception
 while($failure.InnerException){$failure=$failure.InnerException}
 $audit.status='failed';$audit.errorType=$failure.GetType().Name
 $audit.errorCode=if($failure -is [System.Data.SqlClient.SqlException]){[string]$failure.Number}else{'SOURCE_READ_FAILED'}
 $audit.errorLine=if($failure -is [System.Data.SqlClient.SqlException]){[string]$failure.LineNumber}else{$null}
 if(Test-Path -LiteralPath $outputPath){Remove-Item -LiteralPath $outputPath}
} finally {
 $audit.finishedAt=[DateTimeOffset]::UtcNow.ToString('o')
 $audit | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($outputPath+'.audit.json') -Encoding UTF8
 $audit | ConvertTo-Json -Depth 4 -Compress | Write-Output
}
if($audit.status -ne 'succeeded'){exit 1}
