SELECT DB_NAME() AS DatabaseName, ORIGINAL_LOGIN() AS LoginName,
       COL_LENGTH(N'dbo.ext_StockOrderAttribution', N'CapturedAtUtc8') AS CaptureColumnLength,
       COL_LENGTH(N'dbo.ext_StockOrderAttribution', N'RefreshedAtUtc8') AS RefreshColumnLength,
       CONVERT(varchar(23), DATEADD(HOUR,8,SYSUTCDATETIME()),121) AS BeijingNow,
       COUNT_BIG(*) AS MappingCount FROM dbo.ext_StockOrderAttribution
