# Changelog

Public release notes and "things to try" for QA Wolf userscript updates.

## Upcoming: Notes v1.461 / Shortcuts v4.143

### What's changing

- Protects active note editors from background refreshes, including storage events, run-complete chime metrics, and follow-tab switches.
- Adds Daily Work tracking for client-level activity in 15-minute local-time blocks.
- Adds a Notes panel Work tab with client totals, readable time ranges, and copyable end-of-day text.
- Removes the old Shortcuts `Current` overlay beside the run button.
- Adds just-in-case backup instructions before reinstalling the Investigation Notes script.

### Things to try

- **Chime while editing**: open a note card in edit mode with unsaved draft text; let a run complete. Confirm the card stays in edit mode and draft text is unchanged.
- **Cross-tab storage**: with the panel open and a note in edit mode, change note metadata from another tab or trigger a storage refresh. Confirm edit mode persists, then confirm the panel catches up after blur/save.
- **Follow tab while editing**: enable follow-tab, edit a note, then switch files in Monaco. Confirm follow-tab does not yank you out of edit mode mid-draft.
- **Daily Work tracking**: open `app.qawolf.com` on one client, keep the tab visible/focused, then open Notes -> Work. Confirm the current client appears for the current 15-minute block with a 15m total.
- **Daily Work ranges**: after crossing another 15-minute boundary, confirm contiguous blocks collapse into readable ranges and totals are `blocks * 15m`.
- **Overlap allowed**: focus QA Wolf tabs for two different clients during the same 15-minute block. Confirm both clients show that block in Work.
- **Copy report text**: click Work -> Copy and paste somewhere. Confirm it contains client names, total time, and listed ranges.
- **Current button cleanup**: open a QA Wolf IDE page near the run button and confirm the old `Current` shortcut overlay no longer appears.
- **Backup before reinstall**: if reinstalling, run the README backup snippet first and confirm it downloads a `qaw-notes-backup-*.json` file.

### Verification

- `npm test` passes with 94 tests.
- `node build.mjs` passes.
- Editor protection was manually smoke-tested on QA Wolf before release.
