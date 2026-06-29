#!/usr/bin/env node
/**
 * OCR source wrapper for review evidence extraction.
 *
 * Usage:
 *   node scripts/ocr-source.mjs --input docs/norms --out artifacts/ocr/<run-id>
 *   node scripts/ocr-source.mjs --input docs/norms --out build/ocr --force-ocr
 *
 * Input: pdf/png/jpg/jpeg/tif/tiff files.
 * Output: manifest.json, raw/*.txt, json/*.json, markdown/*.md, images/, review-required.jsonl.
 *
 * This script only creates OCR review evidence. It does not create process
 * mapping conclusions or department relationship fields.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const supportedExts = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff']);
const imageExts = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff']);

function usage() {
  return [
    'Usage: node scripts/ocr-source.mjs [--input <file-or-dir>] [--out <dir>] [--engine paddleocr]',
    '',
    'Options:',
    '  --input <path>             Source file or directory. Default: docs/norms',
    '  --out <dir>                Output directory. Default: artifacts/ocr/<timestamp>',
    '  --engine <name>            OCR engine name. Default: paddleocr',
    '  --no-ocr                  Do not call OCR engine; write review-required records',
    '  --force-ocr               OCR PDFs even when a text layer is detected',
    '  --confidence-threshold N  Low-confidence threshold. Default: 0.8',
    '  --preprocess-pdf          Try OCRmyPDF before OCR on PDF files when available',
    '  --help                    Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    input: join(root, 'docs', 'norms'),
    out: null,
    engine: 'paddleocr',
    noOcr: false,
    forceOcr: false,
    confidenceThreshold: 0.8,
    preprocessPdf: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--input') {
      args.input = argv[++index];
    } else if (arg === '--out') {
      args.out = argv[++index];
    } else if (arg === '--engine') {
      args.engine = argv[++index];
    } else if (arg === '--no-ocr') {
      args.noOcr = true;
    } else if (arg === '--force-ocr') {
      args.forceOcr = true;
    } else if (arg === '--confidence-threshold') {
      args.confidenceThreshold = Number(argv[++index]);
    } else if (arg === '--preprocess-pdf' || arg === '--ocrmypdf') {
      args.preprocessPdf = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.confidenceThreshold) || args.confidenceThreshold < 0 || args.confidenceThreshold > 1) {
    throw new Error('--confidence-threshold must be a number between 0 and 1');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  args.input = resolve(root, args.input);
  args.out = resolve(root, args.out ?? join('artifacts', 'ocr', timestamp));
  return args;
}

function toRepoPath(filePath) {
  return relative(root, filePath).replace(/\\/g, '/');
}

function ensureDirs(outDir) {
  for (const dir of ['', 'raw', 'json', 'markdown', 'images']) {
    mkdirSync(join(outDir, dir), { recursive: true });
  }
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function safeName(filePath, hash) {
  const stem = basename(filePath, extname(filePath))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return `${stem}-${hash.slice(0, 10)}`;
}

function collectSources(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`Input path does not exist: ${inputPath}`);
  }

  const stat = statSync(inputPath);
  if (stat.isFile()) {
    return supportedExts.has(extname(inputPath).toLowerCase()) ? [inputPath] : [];
  }

  const files = [];
  const stack = [inputPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && supportedExts.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((a, b) => toRepoPath(a).localeCompare(toRepoPath(b), 'zh-Hans-CN'));
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  return result.status === 0 || result.status === 1;
}

function pythonEnv() {
  const nvidiaDllDirs = [
    join(root, '.venv-paddleocr', 'Lib', 'site-packages', 'nvidia', 'cu13', 'bin', 'x86_64'),
    join(root, '.venv-paddleocr', 'Lib', 'site-packages', 'nvidia', 'cudnn', 'bin'),
  ].filter((dir) => existsSync(dir));
  const currentPath = process.env.PATH ?? '';
  return {
    ...process.env,
    PATH: [...nvidiaDllDirs, currentPath].join(';'),
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
}

function firstAvailablePython() {
  const localReviewItems = [
    join(root, '.venv-paddleocr', 'Scripts', 'python.exe'),
    join(root, '.venv', 'Scripts', 'python.exe'),
  ];
  for (const command of [...localReviewItems, 'python', 'py']) {
    if (command.endsWith('.exe') && !existsSync(command)) {
      continue;
    }
    const result = spawnSync(command, ['-c', 'import sys; print(sys.executable)'], {
      cwd: root,
      encoding: 'utf8',
      env: pythonEnv(),
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.status === 0) {
      return command;
    }
  }
  return null;
}

function inspectPaddle(pythonCommand) {
  if (!pythonCommand) {
    return { available: false, version: null, detail: 'python_missing' };
  }
  const code = [
    'import json',
    'try:',
    '    import paddleocr',
    '    version = getattr(paddleocr, "__version__", None)',
    '    print(json.dumps({"available": True, "version": version}, ensure_ascii=False))',
    'except Exception as exc:',
    '    print(json.dumps({"available": False, "version": None, "detail": str(exc)}, ensure_ascii=False))',
  ].join('\n');
  const result = spawnSync(pythonCommand, ['-c', code], {
    cwd: root,
    encoding: 'utf8',
    env: pythonEnv(),
    timeout: 20_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { available: false, version: null, detail: result.stderr.trim() || 'paddleocr_check_failed' };
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return { available: false, version: null, detail: 'paddleocr_check_unparseable' };
  }
}

function extractPdfTextWithPdftotext(filePath) {
  const result = spawnSync('pdftotext', ['-layout', filePath, '-'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout;
  }
  return '';
}

function inspectPdfTextLayer(filePath, pythonCommand) {
  const pdftotextOutput = extractPdfTextWithPdftotext(filePath);
  if (pdftotextOutput.trim().length > 20) {
    return {
      hasText: true,
      textChars: pdftotextOutput.trim().length,
      pageCount: null,
      method: 'pdftotext',
      textSample: pdftotextOutput.trim().slice(0, 500),
    };
  }

  if (!pythonCommand) {
    return { hasText: false, textChars: 0, pageCount: null, method: 'none', textSample: '' };
  }

  const code = [
    'import json, sys',
    'path = sys.argv[1]',
    'mods = []',
    'try:',
    '    from pypdf import PdfReader',
    '    mods.append("pypdf")',
    'except Exception:',
    '    try:',
    '        from PyPDF2 import PdfReader',
    '        mods.append("PyPDF2")',
    '    except Exception as exc:',
    '        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))',
    '        raise SystemExit(0)',
    'try:',
    '    reader = PdfReader(path)',
    '    texts = []',
    '    for page in reader.pages[:3]:',
    '        try:',
    '            texts.append(page.extract_text() or "")',
    '        except Exception:',
    '            texts.append("")',
    '    text = "\\n".join(texts).strip()',
    '    print(json.dumps({"ok": True, "method": mods[0], "pages": len(reader.pages), "text_chars": len(text), "sample": text[:500]}, ensure_ascii=False))',
    'except Exception as exc:',
    '    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))',
  ].join('\n');
  const result = spawnSync(pythonCommand, ['-c', code, filePath], {
    cwd: root,
    encoding: 'utf8',
    env: pythonEnv(),
    timeout: 30_000,
    windowsHide: true,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    return { hasText: false, textChars: 0, pageCount: null, method: 'unavailable', textSample: '' };
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const textChars = Number(parsed.text_chars ?? 0);
    return {
      hasText: parsed.ok === true && textChars > 20,
      textChars,
      pageCount: parsed.pages ?? null,
      method: parsed.method ?? 'python_pdf',
      textSample: parsed.sample ?? '',
    };
  } catch {
    return { hasText: false, textChars: 0, pageCount: null, method: 'unparseable', textSample: '' };
  }
}

function isStructureSensitive(filePath) {
  const value = toRepoPath(filePath);
  return /(流程图|流程|表单|模板|模版|台账|表格|申请单|审批|签批|记录|附件|chart|form|table|ledger)/i.test(value);
}

function runOcrmypdfIfRequested(filePath, outDir, enabled, available) {
  if (!enabled || extname(filePath).toLowerCase() !== '.pdf') {
    return { filePath, status: 'not_requested', output: null };
  }
  if (!available) {
    return { filePath, status: 'ocrmypdf_missing', output: null };
  }
  const output = join(outDir, 'raw', `${safeName(filePath, sha256(filePath))}.searchable.pdf`);
  const result = spawnSync('ocrmypdf', ['--skip-text', '--deskew', filePath, output], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.status === 0) {
    return { filePath: output, status: 'ok', output };
  }
  return {
    filePath,
    status: 'failed',
    output: null,
    detail: (result.stderr || result.stdout || '').trim().slice(0, 1000),
  };
}

function runPaddleOcr(filePath, pythonCommand, confidenceThreshold) {
  const code = String.raw`
import json
import sys

path = sys.argv[1]
threshold = float(sys.argv[2])

def is_num(value):
    return isinstance(value, (int, float))

def norm_box(box):
    if not isinstance(box, (list, tuple)):
        return None
    if len(box) == 4 and all(isinstance(p, (list, tuple)) and len(p) >= 2 for p in box):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        return [min(xs), min(ys), max(xs), max(ys)]
    if len(box) >= 4 and all(is_num(v) for v in box[:4]):
        return [float(box[0]), float(box[1]), float(box[2]), float(box[3])]
    return None

def iter_legacy(value):
    if isinstance(value, list):
        if len(value) == 2:
            box = norm_box(value[0])
            text_conf = value[1]
            if box is not None and isinstance(text_conf, (list, tuple)) and len(text_conf) >= 2:
                text = str(text_conf[0] or "").strip()
                try:
                    conf = float(text_conf[1])
                except Exception:
                    conf = None
                if text:
                    yield {"text": text, "bbox": box, "confidence": conf}
                    return
        for item in value:
            yield from iter_legacy(item)
    elif isinstance(value, dict):
        texts = value.get("rec_texts") or value.get("texts") or value.get("text")
        scores = value.get("rec_scores") or value.get("scores") or value.get("confidence")
        boxes = value.get("dt_polys") or value.get("boxes") or value.get("bbox")
        if isinstance(texts, list):
            for index, text in enumerate(texts):
                text = str(text or "").strip()
                if not text:
                    continue
                box = None
                if isinstance(boxes, list) and index < len(boxes):
                    box = norm_box(boxes[index])
                conf = None
                if isinstance(scores, list) and index < len(scores):
                    try:
                        conf = float(scores[index])
                    except Exception:
                        conf = None
                yield {"text": text, "bbox": box, "confidence": conf}
        elif isinstance(texts, str) and texts.strip():
            yield {"text": texts.strip(), "bbox": norm_box(boxes), "confidence": None}

try:
    import paddleocr
    from paddleocr import PaddleOCR
    version = getattr(paddleocr, "__version__", None)
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"import_failed: {exc}"}, ensure_ascii=False))
    raise SystemExit(0)

try:
    try:
        ocr = PaddleOCR(lang="ch")
    except Exception:
        ocr = PaddleOCR()
    if hasattr(ocr, "ocr"):
        raw = ocr.ocr(path)
    elif hasattr(ocr, "predict"):
        raw = ocr.predict(path)
    else:
        print(json.dumps({"ok": False, "error": "paddleocr_api_not_found", "version": version}, ensure_ascii=False))
        raise SystemExit(0)
    blocks = []
    for block in iter_legacy(raw):
        blocks.append(block)
    print(json.dumps({"ok": True, "version": version, "blocks": blocks}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc), "version": locals().get("version")}, ensure_ascii=False))
`;
  const result = spawnSync(pythonCommand, ['-c', code, filePath, String(confidenceThreshold)], {
    cwd: root,
    encoding: 'utf8',
    env: pythonEnv(),
    timeout: 180_000,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return {
      ok: false,
      version: null,
      error: (result.stderr || result.stdout || '').trim().slice(0, 1000) || 'paddleocr_failed',
      blocks: [],
    };
  }
  try {
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  } catch {
    return {
      ok: false,
      version: null,
      error: 'paddleocr_output_unparseable',
      blocks: [],
    };
  }
}

function makeReviewRecord({ sourceFile, sourceHash, pageNo = 1, reason, detail = '', ocrVersion = null }) {
  return {
    source_file: toRepoPath(sourceFile),
    source_hash: sourceHash,
    ocr_tool: 'paddleocr',
    ocr_version: ocrVersion,
    page_no: pageNo,
    block_id: `p${String(pageNo).padStart(3, '0')}-review`,
    text: '',
    bbox: null,
    confidence: 0,
    artifact_type: 'image_or_scanned_pdf',
    review_required: true,
    review_reason: reason,
    review_detail: detail,
    evidence_status: 'ocr_extracted_not_confirmed',
  };
}

function normalizeBlocks(blocks, sourceFile, sourceHash, ocrVersion, confidenceThreshold) {
  return blocks.map((block, index) => {
    const confidence = typeof block.confidence === 'number' ? block.confidence : null;
    const reviewRequired = confidence === null || confidence < confidenceThreshold;
    return {
      source_file: toRepoPath(sourceFile),
      source_hash: sourceHash,
      ocr_tool: 'paddleocr',
      ocr_version: ocrVersion,
      page_no: block.page_no ?? 1,
      block_id: `p${String(block.page_no ?? 1).padStart(3, '0')}-b${String(index + 1).padStart(4, '0')}`,
      text: block.text,
      bbox: block.bbox ?? null,
      confidence,
      artifact_type: 'image_or_scanned_pdf',
      review_required: reviewRequired,
      evidence_status: 'ocr_extracted_not_confirmed',
    };
  });
}

function writeSourceOutputs(outDir, outputName, sourceRecord, blocks) {
  const rawText = blocks.map((block) => block.text).filter(Boolean).join('\n');
  writeFileSync(join(outDir, 'raw', `${outputName}.txt`), rawText, 'utf8');
  writeFileSync(
    join(outDir, 'json', `${outputName}.json`),
    JSON.stringify({ source: sourceRecord, blocks }, null, 2),
    'utf8',
  );

  const lines = [
    `# ${sourceRecord.source_file_name}`,
    '',
    `- source_file: ${sourceRecord.source_file}`,
    `- source_hash: ${sourceRecord.source_hash}`,
    `- ocr_tool: ${sourceRecord.ocr_tool}`,
    `- ocr_version: ${sourceRecord.ocr_version ?? 'unknown'}`,
    `- review_required: ${sourceRecord.review_required}`,
    `- evidence_status: ${sourceRecord.evidence_status}`,
    '',
    'OCR text below is review-only source text only. It requires original-file review before downstream use.',
    '',
  ];
  if (blocks.length === 0) {
    lines.push('No OCR text blocks were produced.');
  } else {
    for (const block of blocks) {
      lines.push(`## ${block.block_id}`);
      lines.push('');
      lines.push(`- confidence: ${block.confidence ?? 'unknown'}`);
      lines.push(`- review_required: ${block.review_required}`);
      lines.push('');
      lines.push(block.text || '(empty)');
      lines.push('');
    }
  }
  writeFileSync(join(outDir, 'markdown', `${outputName}.md`), lines.join('\n'), 'utf8');
}

function processSource(filePath, context) {
  const { args, outDir, pythonCommand, paddleInfo, ocrmypdfAvailable, reviewRecords } = context;
  const ext = extname(filePath).toLowerCase();
  const sourceHash = sha256(filePath);
  const outputName = safeName(filePath, sourceHash);
  const sourceFile = toRepoPath(filePath);
  const sourceBase = basename(filePath);

  if (imageExts.has(ext)) {
    copyFileSync(filePath, join(outDir, 'images', `${outputName}${ext}`));
  }

  const baseRecord = {
    source_file: sourceFile,
    source_file_name: sourceBase,
    source_hash: sourceHash,
    ocr_tool: 'paddleocr',
    ocr_version: paddleInfo.version ?? null,
    artifact_type: 'image_or_scanned_pdf',
    evidence_status: 'ocr_extracted_not_confirmed',
    review_required: false,
    processing_status: 'pending',
  };

  if (ext === '.pdf' && !args.forceOcr) {
    const layer = inspectPdfTextLayer(filePath, pythonCommand);
    if (layer.hasText) {
      const sourceRecord = {
        ...baseRecord,
        artifact_type: 'text_pdf',
        review_required: false,
        processing_status: 'skipped_text_layer_available',
        text_layer_method: layer.method,
        text_chars: layer.textChars,
        page_count: layer.pageCount,
      };
      writeSourceOutputs(outDir, outputName, sourceRecord, []);
      return sourceRecord;
    }
  }

  const preprocess = runOcrmypdfIfRequested(filePath, outDir, args.preprocessPdf, ocrmypdfAvailable);
  if (preprocess.status === 'ocrmypdf_missing' || preprocess.status === 'failed') {
    const record = makeReviewRecord({
      sourceFile: filePath,
      sourceHash,
      reason: preprocess.status,
      detail: preprocess.detail ?? '',
      ocrVersion: paddleInfo.version ?? null,
    });
    reviewRecords.push(record);
  }

  if (args.noOcr) {
    const review = makeReviewRecord({
      sourceFile: filePath,
      sourceHash,
      reason: 'ocr_skipped',
      detail: '--no-ocr was used',
      ocrVersion: paddleInfo.version ?? null,
    });
    reviewRecords.push(review);
    const sourceRecord = {
      ...baseRecord,
      review_required: true,
      processing_status: 'ocr_skipped',
      review_reason: 'ocr_skipped',
    };
    writeSourceOutputs(outDir, outputName, sourceRecord, [review]);
    return sourceRecord;
  }

  if (!paddleInfo.available || args.engine !== 'paddleocr') {
    const reason = args.engine === 'paddleocr' ? 'ocr_engine_missing' : 'unsupported_ocr_engine';
    const detail = args.engine === 'paddleocr' ? paddleInfo.detail ?? '' : args.engine;
    const review = makeReviewRecord({
      sourceFile: filePath,
      sourceHash,
      reason,
      detail,
      ocrVersion: paddleInfo.version ?? null,
    });
    reviewRecords.push(review);
    const sourceRecord = {
      ...baseRecord,
      review_required: true,
      processing_status: reason,
      review_reason: reason,
    };
    writeSourceOutputs(outDir, outputName, sourceRecord, [review]);
    return sourceRecord;
  }

  const ocrTarget = preprocess.status === 'ok' ? preprocess.filePath : filePath;
  const ocrResult = runPaddleOcr(ocrTarget, pythonCommand, args.confidenceThreshold);
  if (!ocrResult.ok) {
    const review = makeReviewRecord({
      sourceFile: filePath,
      sourceHash,
      reason: 'ocr_failed',
      detail: ocrResult.error ?? '',
      ocrVersion: ocrResult.version ?? paddleInfo.version ?? null,
    });
    reviewRecords.push(review);
    const sourceRecord = {
      ...baseRecord,
      ocr_version: ocrResult.version ?? paddleInfo.version ?? null,
      review_required: true,
      processing_status: 'ocr_failed',
      review_reason: 'ocr_failed',
    };
    writeSourceOutputs(outDir, outputName, sourceRecord, [review]);
    return sourceRecord;
  }

  const blocks = normalizeBlocks(
    ocrResult.blocks ?? [],
    filePath,
    sourceHash,
    ocrResult.version ?? paddleInfo.version ?? null,
    args.confidenceThreshold,
  );

  const needsLayoutReview = isStructureSensitive(filePath);
  const lowQualityBlocks = blocks.filter((block) => block.review_required);
  if (blocks.length === 0) {
    const review = makeReviewRecord({
      sourceFile: filePath,
      sourceHash,
      reason: 'empty_ocr_result',
      ocrVersion: ocrResult.version ?? paddleInfo.version ?? null,
    });
    reviewRecords.push(review);
    blocks.push(review);
  }
  for (const block of lowQualityBlocks) {
    reviewRecords.push({
      ...block,
      review_reason: 'low_confidence',
    });
  }
  if (needsLayoutReview) {
    reviewRecords.push(makeReviewRecord({
      sourceFile: filePath,
      sourceHash,
      reason: 'layout_structure_review_required',
      detail: 'source path suggests form, table, ledger, flowchart, attachment, or sign-off structure',
      ocrVersion: ocrResult.version ?? paddleInfo.version ?? null,
    }));
  }

  const sourceRecord = {
    ...baseRecord,
    ocr_version: ocrResult.version ?? paddleInfo.version ?? null,
    block_count: blocks.length,
    review_required: needsLayoutReview || blocks.some((block) => block.review_required),
    processing_status: 'ocr_extracted',
  };
  writeSourceOutputs(outDir, outputName, sourceRecord, blocks);
  return sourceRecord;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out;
  ensureDirs(outDir);

  const pythonCommand = firstAvailablePython();
  const paddleInfo = args.engine === 'paddleocr'
    ? inspectPaddle(pythonCommand)
    : { available: false, version: null, detail: 'unsupported_engine' };
  const ocrmypdfAvailable = commandExists('ocrmypdf');
  const sources = collectSources(args.input);
  const reviewRecords = [];

  const manifest = {
    created_at: new Date().toISOString(),
    input: toRepoPath(args.input),
    output_root: toRepoPath(outDir),
    ocr_tool: 'paddleocr',
    ocr_version: paddleInfo.version ?? null,
    tools: {
      python: pythonCommand ?? null,
      paddleocr_available: paddleInfo.available === true,
      paddleocr_detail: paddleInfo.detail ?? null,
      ocrmypdf_available: ocrmypdfAvailable,
    },
    options: {
      force_ocr: args.forceOcr,
      no_ocr: args.noOcr,
      confidence_threshold: args.confidenceThreshold,
      preprocess_pdf: args.preprocessPdf,
    },
    policy: {
      ocr_is_final_evidence: false,
      can_generate_business_conclusions: false,
      downstream_use: 'input_baseline_review_only',
    },
    sources: [],
    totals: {
      sources: 0,
      reviewed_or_deferred: 0,
      extracted: 0,
      skipped_text_pdf: 0,
    },
  };

  for (const filePath of sources) {
    const sourceRecord = processSource(filePath, {
      args,
      outDir,
      pythonCommand,
      paddleInfo,
      ocrmypdfAvailable,
      reviewRecords,
    });
    manifest.sources.push(sourceRecord);
  }

  manifest.totals.sources = manifest.sources.length;
  manifest.totals.reviewed_or_deferred = manifest.sources.filter((source) => source.review_required).length;
  manifest.totals.extracted = manifest.sources.filter((source) => source.processing_status === 'ocr_extracted').length;
  manifest.totals.skipped_text_pdf = manifest.sources.filter((source) => source.processing_status === 'skipped_text_layer_available').length;

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(
    join(outDir, 'review-required.jsonl'),
    reviewRecords.map((record) => JSON.stringify(record)).join('\n') + (reviewRecords.length ? '\n' : ''),
    'utf8',
  );

  console.error(
    `[ocr-source] sources=${manifest.totals.sources} extracted=${manifest.totals.extracted} review=${reviewRecords.length} out=${manifest.output_root}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[ocr-source] ${error.message}`);
  process.exit(1);
}
