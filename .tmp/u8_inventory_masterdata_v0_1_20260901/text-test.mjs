import fs from "node:fs/promises";
import { Workbook } from "file:///C:/Users/charl/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("t");
sheet.getRange("A1:A3").format.numberFormat = "@";
sheet.getRange("A1:A3").values = [["01"], ["030005"], ["200637"]];
sheet.getRange("B1:B3").values = [["01"], ["030005"], ["200637"]];
sheet.getRange("B1:B3").format.numberFormat = "@";
sheet.getRange("C1:C3").formulas = [['="01"'], ['="030005"'], ['="200637"']];
sheet.getRange("D1:D3").values = [["\u200B01"], ["\u200B030005"], ["\u200B200637"]];
const preview = await workbook.render({ sheetName: "t", range: "A1:D3", format: "png", scale: 2, headers: true });
await fs.writeFile("E:/CA001/Infomat/.tmp/u8_inventory_masterdata_v0_1_20260901/text-test.png", new Uint8Array(await preview.arrayBuffer()));
console.log(JSON.stringify(sheet.getRange("A1:D3").values));
