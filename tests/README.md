# Tests

No browser needed. These run the real `index.html` app logic under
Node by extracting its `<script>` contents into a small VM sandbox
with a minimal DOM/localStorage shim (`dom-shim.js`).

```bash
node tests/build-harness.js   # regenerates tests/harness-script.js from ../index.html
node tests/run_tests.js       # runs the suite
```

Covers: storage fallback (artifact storage failing/missing),
completion math, streak edge cases (0–12/12, missing days, future
dates), calendar month-length/leap-year handling, mood id migration,
import validation, export shape, i18n string resolution across all
5 languages, the Settings draft/Save flow, sound-effects persistence,
and main-screen habit add/manage/delete via real DOM interaction.
