// Preserve mysql2's source-value types when a maintenance transport returns text
// rows. Only documented numeric DATA_TYPEs are converted; CAST-to-text types,
// unknown types, binary values and NULL are never inferred from their contents.
const integers=new Set(['tinyint','smallint','mediumint','int','integer','year']);
const floating=new Set(['float','double','real']);
const failure=()=>Object.assign(new Error('MIGRATION_SOURCE_NUMERIC_INVALID'),{code:'MIGRATION_SOURCE_NUMERIC_INVALID',statusCode:409});
function sourceValue(value,column){
  const type=column.data_type;
  if(value===null||(!integers.has(type)&&!floating.has(type)))return value;
  if(typeof value!=='number'&&typeof value!=='string')throw failure();
  if(typeof value==='string'&&!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))throw failure();
  let number=Number(value);
  if(!Number.isFinite(number)||(Number.isInteger(number)&&!Number.isSafeInteger(number)))throw failure();
  if(integers.has(type)&&!Number.isSafeInteger(number))throw failure();
  // Prepared mysql2 FLOAT rows use IEEE-754 single precision. Reconstruct that
  // exact number from the server's text representation, without changing DOUBLE.
  if(type==='float')number=Math.fround(number);
  if(!Number.isFinite(number)||(Number.isInteger(number)&&!Number.isSafeInteger(number)))throw failure();
  return number;
}
module.exports={sourceValue};
