import { describe, it, expect } from 'vitest';
import { SCOPE_RESOLVERS } from '../../../src/core/ingestion/scope-resolution/pipeline/registry.js';
import {
  SCOPE_RESOLUTION_LANGUAGES,
  isScopeResolutionLanguage,
} from '../../../src/core/ingestion/scope-resolution/pipeline/migrated-languages.js';

describe('SCOPE_RESOLUTION_LANGUAGES drift guard', () => {
  // The parse worker gates ParsedFile emission on `isScopeResolutionLanguage`,
  // which is derived from SCOPE_RESOLUTION_LANGUAGES — a hand-maintained
  // duplicate of the SCOPE_RESOLVERS key set (kept resolver-import-free so the
  // worker bundle stays light). The dangerous drift is asymmetric: a language
  // in this Set but missing from SCOPE_RESOLVERS would have its ParsedFile
  // skipped in the worker AND never re-extracted by scope resolution →
  // permanent loss. This test fails if the two ever diverge (#1983).
  it('covers exactly the languages registered in SCOPE_RESOLVERS', () => {
    const resolverLangs = [...SCOPE_RESOLVERS.keys()].sort();
    const skipSetLangs = [...SCOPE_RESOLUTION_LANGUAGES].sort();
    expect(skipSetLangs).toEqual(resolverLangs);
  });

  it('isScopeResolutionLanguage returns true for every registered resolver language and false for null', () => {
    for (const lang of SCOPE_RESOLVERS.keys()) {
      expect(isScopeResolutionLanguage(lang)).toBe(true);
    }
    expect(isScopeResolutionLanguage(null)).toBe(false);
  });
});
