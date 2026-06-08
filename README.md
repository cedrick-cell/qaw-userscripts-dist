# QA Wolf Userscripts

Public install channel for QA Wolf Tampermonkey userscripts.

See [CHANGELOG.md](./CHANGELOG.md) for recent updates.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome, Arc, or another Chromium browser.
2. Open each script link you want below.
3. Tampermonkey should show an install screen. Click **Install**.
4. Refresh any open QA Wolf / Task Wolf tabs after installing or updating.

## Scripts

- [Install QA Wolf Investigation Notes](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-investigation-notes.user.js)
- [Install Keyboard Shortcuts](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-shortcuts.user.js)
- [Install Run Complete Chime](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-run-complete-chime.user.js)

## Updating

Tampermonkey checks for userscript updates automatically. To check manually:

1. Open the Tampermonkey dashboard.
2. Go to the **Installed userscripts** tab.
3. Click **Check for userscript updates**.
4. Refresh QA Wolf / Task Wolf tabs after updates install.

## Troubleshooting

- If a script does not appear, make sure it is enabled in the Tampermonkey dashboard.
- If QA Wolf feels slow or broken after an update, disable the script in Tampermonkey and refresh the tab.
- If Investigation Notes is open, use **Settings → Notes → Copy diagnostics** and send the copied text with your bug report.
- Source, issues, and pull requests live in the private `qaw-userscripts` repo.

**Release schedule:** dist updates publish nightly around 06:00 UTC. Add the **`hotfix`** label to a PR before merge for an immediate publish after merge.
