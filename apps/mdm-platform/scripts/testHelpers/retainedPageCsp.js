// Shared inspection for the retained static page's CSP checks. No file or network IO.
const crypto = require('node:crypto');

function scriptCspHash(code) {
  // HTML parsing normalizes CRLF and isolated CR before the script becomes DOM text.
  // Preserve every other character: whitespace or code changes must still invalidate the hash.
  const domText = code.replace(/\r\n?/g, '\n');
  return `sha256-${crypto.createHash('sha256').update(domText, 'utf8').digest('base64')}`;
}

function inlineScriptBlocks(html) {
  const blocks = [];
  const pattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    blocks.push({
      line: html.slice(0, match.index).split(/\r\n?|\n/).length,
      code: match[1]
    });
  }
  return blocks;
}

module.exports = { scriptCspHash, inlineScriptBlocks };
