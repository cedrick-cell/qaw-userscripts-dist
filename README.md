# QA Wolf Userscripts

Public install channel for QA Wolf Tampermonkey userscripts.

See [CHANGELOG.md](./CHANGELOG.md) for recent updates and things to try after installing.

## Installing The Investigation Notes Panel

### 1. Install Tampermonkey

If you don't have it already, install the [Tampermonkey extension](https://www.tampermonkey.net/) for Chrome.

### 2. Optional: back up existing notes before reinstalling

Existing notes should stay intact because they live in `app.qawolf.com` localStorage, not in the userscript install. If you already have notes and want a safety backup before reinstalling, open [app.qawolf.com](https://app.qawolf.com), open DevTools -> Console, and run:

```js
(() => {
  const backup = {
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    localStorage: {},
  };

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("_qaw")) {
      backup.localStorage[key] = localStorage.getItem(key);
    }
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qaw-notes-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
```

For a readable backup, open Notes -> **Export** -> select all clients/environments -> **Copy markdown**.

### 3. Install the script

Click this link while Tampermonkey is active, then click **Install** in the Tampermonkey dialog:

**[Install QA Wolf Investigation Notes](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-investigation-notes.user.js)**

### 4. You're done

Open [app.qawolf.com](https://app.qawolf.com) and the notes panel will appear on the right side of the IDE. Updates are delivered automatically; Tampermonkey will notify you when a new version is available.

## Optional Scripts

These install the same way: click the link, then click **Install** in the Tampermonkey dialog.

- **[Keyboard Shortcuts](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-shortcuts.user.js)** - shortcut hints and nav helpers across app.qawolf.com
- **[Run Complete Chime](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-run-complete-chime.user.js)** - plays a short sound when a code run finishes

## Updating

Updates are pushed to this live channel when they're ready. Tampermonkey checks for updates automatically; you can also trigger a manual check via the Tampermonkey dashboard.

If an update isn't appearing, open Tampermonkey -> Dashboard -> find "QA Wolf Investigation Notes" -> click the update icon.

Source, issues, and pull requests live in the private `qaw-userscripts` repo.
