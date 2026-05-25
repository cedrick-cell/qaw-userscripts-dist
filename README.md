# QA Wolf Userscripts

Public install channel for QA Wolf Tampermonkey userscripts.

## Install / Update

Open each link you want, then click **Install** or **Update** in Tampermonkey:

- [Install QA Wolf Investigation Notes](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-investigation-notes.user.js)
- [Install Keyboard Shortcuts](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-shortcuts.user.js)
- [Install Run Complete Chime](https://raw.githubusercontent.com/cedrick-cell/qaw-userscripts-dist/main/qa-wolf-run-complete-chime.user.js)

Updating a userscript should not delete your existing notes. Notes are stored in your browser's `localStorage` for `app.qawolf.com`, not inside the userscript file.

## Optional Backup Before Updating

If you want a just-in-case backup of all Investigation Notes data before updating:

1. Open `app.qawolf.com` in the browser/profile where you use the notes panel.
2. Open DevTools → **Console**.
3. Paste and run this snippet.
4. Keep the downloaded JSON file somewhere safe.

```js
(() => {
  const noteKeys = new Set([
    "_qawInvNotes",
    "_qawInvNotesMeta",
    "_qawFlowHistory",
  ]);
  const backup = {
    exportedAt: new Date().toISOString(),
    origin: location.origin,
    items: {},
  };

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("_qawNote_") || noteKeys.has(key)) {
      backup.items[key] = localStorage.getItem(key);
    }
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `qawolf-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
})();
```

This only reads from `localStorage` and downloads a JSON file. It does not change or delete notes.

## What's Changed

See [CHANGELOG.md](./CHANGELOG.md) for recent releases and suggested things to try.

Source, issues, and pull requests live in the private `qaw-userscripts` repo.
