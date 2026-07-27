#!/usr/bin/env python
"""Validate one JSON document against a Draft 2020-12 schema."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", required=True)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    schema = json.loads(Path(args.schema).read_text(encoding="utf-8"))
    document = json.loads(Path(args.input).read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(document), key=lambda item: list(item.absolute_path))
    if errors:
        for error in errors:
            location = "/" + "/".join(str(part) for part in error.absolute_path)
            print(f"{location or '/'} {error.message}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
