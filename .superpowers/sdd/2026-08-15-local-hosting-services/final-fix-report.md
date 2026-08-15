# Final Fix Wave Report

## Fixes

1. **Docroot nginx injection**
   - `src-tauri/src/modules/services/spec.rs:50-62`: `valid_docroot` now permits `.` or slash-separated segments containing only ASCII letters, digits, `.`, `_`, and `-`. It rejects empty segments, `.` and `..` segments, leading `/`, backslashes, and all other bytes including nginx metacharacters and control characters.
   - Tests at `src-tauri/src/modules/services/spec.rs:220-251` cover rejection of `public;`, `pub\"lic`, `pub{lic`, `publ\nic`, `a b`, and `a$b`, plus acceptance of `public`, `web/dist`, `my.site`, `_static`, and `.well-known`.

2. **Deterministic database volume names**
   - `src-tauri/src/modules/services/compose.rs:130-136`: database volume declarations now render an explicit Compose `name:` equal to the catalog key, preventing the `terra_` project prefix from changing the runtime volume name.
   - Updated `src-tauri/src/modules/services/compose.rs:185-189` to assert the rendered MariaDB volume includes `name: terra_mariadb_data`.

3. **Pinned Composer image**
   - `src-tauri/src/modules/services/dockerfile.rs:13`: changed the Composer source image from `composer:2` to `composer:2.10.2`.
   - Strengthened tests at `src-tauri/src/modules/services/dockerfile.rs:42-63` to require `composer:2.10.2` and reject the bare `composer:2 ` tag.

4. **Runtime probe error state**
   - `src/modules/services/RuntimeCard.tsx:16-47`: added `error` state, catches rejected runtime probes with `setError(String(e))`, clears the error after a successful probe, and renders the error with the existing `Check again` retry button. Existing ready and status rendering remains unchanged.

## Verification

- `docker exec terra-build bash -lc 'cd /work/src-tauri && for filter in services::spec services::compose services::dockerfile; do cargo test --locked "$filter" || exit 1; done'`
  - `services::spec`: 11 passed, 0 failed
  - `services::compose`: 9 passed, 0 failed
  - `services::dockerfile`: 4 passed, 0 failed
- `docker exec terra-build bash -lc 'cd /work/src-tauri && cargo test --locked services'`
  - 49 passed, 0 failed
- `docker exec terra-build bash -lc 'cd /work/src-tauri && cargo clippy --all-targets --locked -- -D warnings'`
  - Finished successfully with no warnings.
- `pnpm test`
  - 81 test files passed, 1193 tests passed.
- `pnpm lint && pnpm check-types && pnpm knip`
  - Lint and type checks passed. Knip passed with its existing configuration hints.
- `pnpm exec biome format ./src/modules/services/RuntimeCard.tsx ./src/modules/services/RuntimeCard.test.ts`
  - Passed with no formatting changes.
- `git diff --check`
  - Passed.
- Primary LSP diagnostics for changed frontend files
  - No diagnostics.

## Notes

- The exact multi-filter cargo command in the request is not accepted by Cargo because `cargo test` takes one test filter. The equivalent sequential filters above were run successfully.
- `cargo fmt --all -- --check` could not run because `cargo-fmt` is not installed in the build container.
