# Drunk Drawing

Drunk Drawing is a same-room drawing and guessing game. Your team guesses out loud while your ink drifts away from where you aim.

Run `npm ci` and `npm run dev`, then open the URL Vite prints. Use `npm test` for the game logic tests and `npm run build` to make a static build. All 1,055 prompts are bundled locally. Each is rated easy, medium, or hard in `shared/badDrawWords.js`; hard words are hidden for now (see `pickWord` in `src/badDraw.js`), leaving 556 in play. The game needs no backend.

It is built for touch screens only (phones and tablets). There are no keyboard or controller controls.

## iPad installation and offline play

After the GitHub Pages deployment finishes, open the game's HTTPS URL in Safari
(normally `https://<owner>.github.io/drunk-drawing/`). Wait for **Ready for offline
play** below the version, then choose **Share → Add to Home Screen → Add**. Open
the new icon while online once and wait for the same message before disconnecting;
iPadOS may give the installed app separate storage. The game opens standalone,
supports both orientations, and retains the existing safe-area and touch handling.

The production build uses `vite-plugin-pwa` with a custom Workbox worker. Relative
manifest, icon, start URL, scope, and worker paths support the existing `--base=./`
Pages build. All built HTML, JS, CSS, images, fonts, model and audio formats are
precached, including the 4.1 MB music track. The per-file limit is 20 MiB; exceeding
it fails the build. Offline audio supports HTTP range requests. No external API,
font service, or CDN is needed during play. Sharing still depends on device support.

Updates are checked at launch, on returning to the app or going online, and hourly
while visible. A new worker downloads its asset set before waiting. The menu shows
an update notice; close **all** game tabs and installed windows, then reopen to
activate. Updates never force a reload or take over a running round. Superseded
precache entries are removed on activation, and cache names include the game's
registration scope to isolate it from other games on the same Pages domain.

If installation fails, reconnect and reopen. To reinstall, remove the home-screen
icon, revisit the Pages URL in Safari, and repeat installation. Clearing website
data is a last resort: it also removes preferences and stored drawings. iPadOS can
evict offline data under storage pressure; reopen online to recache. Gallery
retention remains session-based, as described below.

Run `npm run test:pwa` after `npx playwright install chromium` for the browser
checks, or set `CHROME_PATH` to a local Chrome executable. The test serves the
production build under `/drunk-drawing/` and checks initial caching, every emitted
asset offline, offline reload/reopen, audio byte ranges, starting and drawing a
round offline, return online, and waiting/activation of a simulated deployment.
`npm test` remains the existing game logic suite; the Pages workflow is unchanged.
Physical iPad testing is still required for Add to Home Screen, standalone status
bar/safe-area appearance in both orientations, real airplane-mode relaunch, audio,
and iPadOS background/close behavior. No live Pages deployment is performed by
these local checks.

Pick a mode on the main menu. In **Live** mode (the default) the team watches and guesses while the drawer draws. In **Reveal** mode the drawer draws alone for the whole round (or taps **Done drawing**), then the paper is covered. They pass the tablet to their team, who tap **Reveal** to see the drawing and start their own clock, the same length as the round. Only guessing time counts toward the score.

Pick a drawer and have everyone else look away. Press and hold **Hold to reveal**, then let go before starting the timer. Drag your finger on the paper to draw. The drawer can use **Undo** twice and **Clear** once. Tap **Correct!** when the group guesses the word. The final drawing and score appear when the round ends; tap **Replay** to watch it being drawn again, sped up, with pauses between strokes shortened (see `replayDrawing` in `src/badDrawCanvas.js`). Tap the logo at any time to go back to the main menu.

Every finished round's drawing goes into the **Gallery** (on the results card, and on the main menu between rounds), captioned with the word and the score. Tap a drawing to share or save it, or use **Share all** for one image with the whole night. Rounds left with **Back** aren't kept. The gallery lasts until you clear it or close the tab, and is kept across reloads when it fits in session storage (see `src/gallery.js`).

The ink wobbles with a slow lean, gets further off and faster as the clock runs down (1.75× by the end), and hiccups about once every 8 seconds (round length ÷ 8 s, rounded) at random moments: a quick jolt out and back, with a "hic!" by the pen. A beer meter in the top bar fills up over the round, from Sober to Wasted. The ink swells and thins 3 times a round at random moments, from about two-thirds of its set width up to 2.2× (tune it with **Ink swell size** and **Ink swells per round** in Settings; see `createInkWidth` in `shared/badDraw.js`). The paper fills the screen between the top bar and the buttons, taking the shape of the free space when the round starts.

Pick a difficulty before each round. **Easy** is a steady sway with 4 hiccups (one every 11 seconds), 45 seconds, 2 undos, and 1 clear. **Medium** uses the defaults above: 4 hiccups, 30 seconds, 1 undo, and 1 clear. **Hard** is a blackout wobble, further and faster, with 2 bigger hiccups, 15 seconds, no undos, and 1 clear. The clock turns red for the last 10, 8, or 5 seconds. Presets live in `PRESETS` in `src/badDraw.js`. To fine-tune a round, tap the gear next to the Continue button on the main menu. Settings are only available before a round starts, never during one. Tuning carries over until you reset it, change difficulty, or reload the page. The game starts in dark mode; tap the sun button in the top-right corner to switch to light (it shows a moon to switch back). That choice is remembered on the device. The drawing paper follows it: dark paper with light ink in dark mode, cream paper with dark ink in light mode. Gallery cards and the shared sheet use the current theme too.

Additional prompts were sourced from the [Datamuse API](https://www.datamuse.com/api/) and screened using [Brysbaert et al.’s concreteness ratings](https://pubmed.ncbi.nlm.nih.gov/24142837/).
