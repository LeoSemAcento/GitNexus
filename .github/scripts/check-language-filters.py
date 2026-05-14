#!/usr/bin/env python3
"""Enforce per-language CI filter consistency.

`gitnexus/src/core/ingestion/registry-primary-flag.ts` is the single source
of truth for which languages run through the RFC #909 Ring 3 scope-parity
gate. CI references that list in three places that must stay synchronised:

  1. `.github/workflows/ci.yml` — per-language filter blocks under the
     `paths-changes` job's `Detect web, shared, and per-language changes`
     step. Each migrated language MUST have a `<slug>:` filter block,
     otherwise PRs touching that language won't trigger its parity entry.

  2. `.github/workflows/ci.yml` — the `FULL_LANG_LIST` env var inside the
     `Compute outputs` step. Drives the conservative full-matrix default
     for non-PR callers (release-candidate, publish via workflow_call)
     AND the fallback when `dorny/paths-filter` itself fails.

  3. `.github/workflows/ci-scope-parity.yml` — the `changed-languages`
     input's `default:` value. Drives the conservative full matrix when
     a caller invokes scope-parity without passing the input.

When a language is added to or removed from `MIGRATED_LANGUAGES`, all
three locations must change in the same commit, or the parity gate
silently under-runs (new language not validated) or over-runs (dropped
language still consumes runner time). This script asserts the three
locations agree with the TypeScript source of truth.

Invoked from `.github/workflows/ci-quality.yml`. Runs locally too:
    python3 .github/scripts/check-language-filters.py [repo-root]

The script is dependency-free regex parsing — no Node.js setup required
on the CI runner. The grammar of the TS source-of-truth file is stable
enough that a regex is preferable to spawning `tsx` for a five-second
check.
"""

from __future__ import annotations

import pathlib
import re
import sys


# Parses `Python = 'python',` or `Python = "python",` inside the
# `SupportedLanguages` enum. Captures (TypeScript identifier, string slug).
ENUM_MEMBER_RE = re.compile(r"^\s*(\w+)\s*=\s*['\"]([^'\"]+)['\"]")

# Parses `SupportedLanguages.Python,` inside the `MIGRATED_LANGUAGES` set
# body. Captures the TypeScript identifier.
MIGRATED_REF_RE = re.compile(r"SupportedLanguages\.(\w+)")

# Pull the bracketed JSON-array string out of a `FULL_LANG_LIST: '[...]'`
# or `default: '[...]'` line. Captures the inner array including brackets.
ARRAY_LITERAL_RE = re.compile(r"\[[^\]]*\]")


def read_enum_map(languages_ts: pathlib.Path) -> dict[str, str]:
    """Return TypeScript-identifier -> slug for every SupportedLanguages entry."""
    out: dict[str, str] = {}
    inside_enum = False
    for raw in languages_ts.read_text(encoding="utf-8").splitlines():
        if not inside_enum:
            if "export enum SupportedLanguages" in raw:
                inside_enum = True
            continue
        if "}" in raw:
            break
        m = ENUM_MEMBER_RE.match(raw)
        if m:
            out[m.group(1)] = m.group(2)
    if not out:
        print(f"::error file={languages_ts}::could not parse SupportedLanguages enum")
        sys.exit(2)
    return out


def read_migrated_slugs(flag_ts: pathlib.Path, enum_map: dict[str, str]) -> list[str]:
    """Return the slug list referenced by MIGRATED_LANGUAGES, in source order."""
    text = flag_ts.read_text(encoding="utf-8")
    # Restrict the search to the body of the MIGRATED_LANGUAGES const so we
    # don't accidentally pick up unrelated SupportedLanguages.X references
    # elsewhere in the file (e.g. inside doc comments or other helpers).
    start = text.find("MIGRATED_LANGUAGES")
    if start == -1:
        print(f"::error file={flag_ts}::could not locate MIGRATED_LANGUAGES export")
        sys.exit(2)
    open_bracket = text.find("[", start)
    close_bracket = text.find("]", open_bracket)
    if open_bracket == -1 or close_bracket == -1:
        print(f"::error file={flag_ts}::MIGRATED_LANGUAGES body not bracketed by [ ... ]")
        sys.exit(2)
    body = text[open_bracket : close_bracket + 1]
    slugs: list[str] = []
    for m in MIGRATED_REF_RE.finditer(body):
        ident = m.group(1)
        slug = enum_map.get(ident)
        if slug is None:
            print(
                f"::error file={flag_ts}::MIGRATED_LANGUAGES references "
                f"SupportedLanguages.{ident}, which is not declared in the enum"
            )
            sys.exit(2)
        slugs.append(slug)
    if not slugs:
        print(f"::error file={flag_ts}::MIGRATED_LANGUAGES is empty — parity gate will not run")
        sys.exit(2)
    return slugs


def read_filter_blocks(ci_yml: pathlib.Path, slugs: list[str]) -> set[str]:
    """Return the subset of `slugs` that have a filter block in ci.yml.

    The filter block grammar is a YAML key at consistent indentation:
        python:
          - 'gitnexus/src/core/ingestion/languages/python/**'
    We match each candidate slug as `<slug>:` at some indent level. Anchoring
    to start-of-line + whitespace would also match other YAML keys (e.g. a
    field named `python:` elsewhere), so we restrict the search to a
    window after the `Detect web, shared, and per-language changes` step
    marker to keep false positives out.
    """
    text = ci_yml.read_text(encoding="utf-8")
    marker = "Detect web, shared, and per-language changes"
    start = text.find(marker)
    if start == -1:
        print(
            f"::error file={ci_yml}::could not locate "
            f"'{marker}' step — language-filter consistency cannot be verified"
        )
        sys.exit(2)
    # Window is from the marker to the next top-level `- name:` step or the
    # next job declaration (anything starting at column 6 or fewer).
    rest = text[start:]
    found: set[str] = set()
    for slug in slugs:
        # `<slug>:` flush with the filter indent level (12 spaces in the
        # canonical layout). The pattern intentionally matches any
        # whitespace indent to tolerate minor reflow.
        pat = re.compile(rf"^\s+{re.escape(slug)}:\s*$", re.MULTILINE)
        if pat.search(rest):
            found.add(slug)
    return found


def read_array_literal(workflow_yml: pathlib.Path, line_prefix: str) -> list[str]:
    """Locate the FIRST line containing `line_prefix` and parse its JSON-array literal."""
    text = workflow_yml.read_text(encoding="utf-8")
    for raw in text.splitlines():
        if line_prefix in raw:
            m = ARRAY_LITERAL_RE.search(raw)
            if m is None:
                print(
                    f"::error file={workflow_yml}::found '{line_prefix}' line "
                    f"but could not extract JSON-array literal"
                )
                sys.exit(2)
            inner = m.group(0).strip("[]").strip()
            if not inner:
                return []
            parts = [p.strip().strip('"').strip("'") for p in inner.split(",")]
            return [p for p in parts if p]
    print(f"::error file={workflow_yml}::could not locate '{line_prefix}' line")
    sys.exit(2)


def check(repo_root: pathlib.Path) -> int:
    languages_ts = repo_root / "gitnexus-shared" / "src" / "languages.ts"
    flag_ts = repo_root / "gitnexus" / "src" / "core" / "ingestion" / "registry-primary-flag.ts"
    ci_yml = repo_root / ".github" / "workflows" / "ci.yml"
    scope_parity_yml = repo_root / ".github" / "workflows" / "ci-scope-parity.yml"

    for path in (languages_ts, flag_ts, ci_yml, scope_parity_yml):
        if not path.is_file():
            print(f"::error file={path}::required file missing")
            return 2

    enum_map = read_enum_map(languages_ts)
    expected = read_migrated_slugs(flag_ts, enum_map)
    expected_set = set(expected)

    fail = 0

    # 1. Each migrated slug has a filter block in ci.yml.
    found = read_filter_blocks(ci_yml, expected)
    missing = expected_set - found
    if missing:
        for slug in sorted(missing):
            print(
                f"::error file={ci_yml}::no filter block found for migrated "
                f"language '{slug}' under the paths-changes step. Add a "
                f"`{slug}:` filter block with the language's ingestion + "
                f"resolver-test path globs, or remove the language from "
                f"MIGRATED_LANGUAGES."
            )
        fail = 1

    # 2. ci.yml's FULL_LANG_LIST env var matches the source-of-truth slug set.
    actual_ci_full = read_array_literal(ci_yml, "FULL_LANG_LIST:")
    if set(actual_ci_full) != expected_set:
        print(
            f"::error file={ci_yml}::FULL_LANG_LIST in the paths-changes "
            f"compute step does not match MIGRATED_LANGUAGES.\n"
            f"  expected: {sorted(expected_set)}\n"
            f"  actual:   {sorted(actual_ci_full)}"
        )
        fail = 1

    # 3. ci-scope-parity.yml's changed-languages default matches.
    actual_sp_default = read_array_literal(scope_parity_yml, "default: '[")
    if set(actual_sp_default) != expected_set:
        print(
            f"::error file={scope_parity_yml}::`changed-languages` input "
            f"default does not match MIGRATED_LANGUAGES.\n"
            f"  expected: {sorted(expected_set)}\n"
            f"  actual:   {sorted(actual_sp_default)}"
        )
        fail = 1

    if fail == 0:
        print(f"Per-language filter consistency: OK ({len(expected)} languages)")
        print(f"  MIGRATED_LANGUAGES: {expected}")
    return fail


def main(argv: list[str]) -> int:
    if len(argv) > 2:
        print(f"usage: {argv[0]} [repo-root]", file=sys.stderr)
        return 2
    repo_root = pathlib.Path(argv[1]) if len(argv) == 2 else pathlib.Path.cwd()
    if not repo_root.is_dir():
        print(f"not a directory: {repo_root}", file=sys.stderr)
        return 2
    return check(repo_root)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
