# BAR Map Studio

A Windows desktop app (Electron) for making and editing maps for [Beyond All Reason](https://www.beyondallreason.info/).

## Run

Needs Node 24. Install the dependencies once with `npm install`, then:

- `npm start` opens the app.
- `npm test` runs the tests. One of them launches the real app, so a window flashes up for a few seconds. It also saves a screenshot to `.engine-tmp/screenshots/wave0-app.png` (gitignored).

The app runs fully offline and never loads remote content.

## Layout

- `app/main.js` is the Electron main process.
- `app/renderer/` holds the page shown in the window.
- `tests/` holds the `node:test` tests.
- `legacy/` is the old browser prototype, kept for reference only.
