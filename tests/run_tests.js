const fs = require("fs");
const vm = require("vm");
const { makeSandbox } = require(require("path").join(__dirname, "dom-shim.js"));

const code = fs.readFileSync(require("path").join(__dirname, "harness-script.js"), "utf8");

let pass = 0, fail = 0;
function assert(cond, msg){ if(cond) pass++; else { fail++; console.log("FAIL:", msg); } }
function assertEqual(actual, expected, msg){
  assert(actual === expected, msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}
function loadApp(sandboxOpts){
  const sandbox = makeSandbox(sandboxOpts);
  const context = vm.createContext(sandbox);
  vm.runInContext(code, context);
  return { app: sandbox.window.__APP__, sandbox: sandbox };
}

async function main(){

  /* ---- carried-over regressions from the v1 fix pass ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const ds = "2026-09-12";
    const enabled = app.state.config.habits.filter(h => h.enabled);
    assertEqual(enabled.length, 12, "12 default habits still present");
    const day = app.ensureDay(ds);
    [0,1,2,3,4,5].forEach(i => day.habits[enabled[i].id] = true);
    assertEqual(app.computeCompletion(ds).pct, 50, "6/12 = 50%");
    [6,7,8,9].forEach(i => day.habits[enabled[i].id] = true);
    assertEqual(app.computeCompletion(ds).pct, 83, "10/12 = 83%");
  }
  {
    const { app } = loadApp({ withArtifactStorage:false });
    app.state.config.habits.forEach(h => h.enabled = false);
    const c = app.computeCompletion("2026-09-12");
    assertEqual(c.total, 0, "zero enabled habits -> total 0");
    assert(!Number.isNaN(c.pct), "pct never NaN with zero habits");
  }
  {
    let setCalls = 0;
    const artifactImpl = { get(){ return Promise.resolve(null); }, set(){ setCalls++; return Promise.reject(new Error("Storage set failed: Internal server error")); } };
    const { app, sandbox } = loadApp({ withArtifactStorage:true, artifactImpl });
    await new Promise(r => setTimeout(r, 20));
    app.ensureDay("2026-09-12").habits["h1"] = true;
    app.persist();
    await new Promise(r => setTimeout(r, 400));
    assert(setCalls >= 1, "artifact set() attempted with the exact reported error");
    const raw = sandbox._localStore["consistency-tracker-data"];
    assert(!!raw, "localStorage fallback received the data after artifact failure");
  }
  {
    const { app } = loadApp({ withArtifactStorage:false });
    let threw = false;
    try{ app.loadAndInit(); }catch(e){ threw = true; }
    assert(!threw, "standalone (no window.storage) load never throws — the downloaded-file blank-page bug stays fixed");
  }

  /* ---- i18n ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    assertEqual(app.state.settings.language, "en", "default language is English");
    assertEqual(app.t("tabToday"), "Today", "English strings resolve");
    app.state.settings.language = "tr";
    assertEqual(app.t("tabToday"), "Bugün", "Turkish strings resolve once language changes");
    app.state.settings.language = "es";
    assertEqual(app.t("tabToday"), "Hoy", "Spanish strings resolve");
    app.state.settings.language = "de";
    assertEqual(app.t("tabToday"), "Heute", "German strings resolve");
    app.state.settings.language = "fr";
    assertEqual(app.t("tabToday"), "Aujourd'hui", "French strings resolve");
    app.state.settings.language = "xx"; // unknown/corrupted
    assertEqual(app.t("tabToday"), "Today", "unknown language code falls back to English rather than crashing");
  }
  {
    const { app } = loadApp({ withArtifactStorage:false });
    app.state.settings.language = "de";
    assertEqual(app.t("completedOf", {completed:6, total:12}), "6 / 12 erledigt", "template substitution works in a non-English string");
  }
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const s1 = app.sanitizeSettings({language:"fr", soundEffects:false});
    assertEqual(s1.language, "fr", "sanitizeSettings accepts a valid language");
    assertEqual(s1.soundEffects, false, "sanitizeSettings accepts a valid boolean");
    const s2 = app.sanitizeSettings({language:"klingon", soundEffects:"yes"});
    assertEqual(s2.language, "en", "sanitizeSettings rejects an invalid language code, falls back to en");
    assertEqual(s2.soundEffects, true, "sanitizeSettings rejects a non-boolean soundEffects, falls back to true");
    const s3 = app.sanitizeSettings(undefined);
    assertEqual(s3.language, "en", "sanitizeSettings handles completely missing settings (old save file)");
  }

  /* ---- settings persist across a simulated reload (language + sound) ---- */
  {
    const { app: app1, sandbox: sb1 } = loadApp({ withArtifactStorage:false });
    app1.state.settings.language = "de";
    app1.state.settings.soundEffects = false;
    await app1.StorageLayer.set("consistency-tracker-data", JSON.stringify({config: app1.state.config, days: app1.state.days, settings: app1.state.settings}));

    const sandbox2 = require(require("path").join(__dirname, "dom-shim.js")).makeSandbox({ withArtifactStorage:false });
    sandbox2._localStore["consistency-tracker-data"] = sb1._localStore["consistency-tracker-data"];
    const context2 = vm.createContext(sandbox2);
    vm.runInContext(code, context2);
    const app2 = sandbox2.window.__APP__;
    await app2.loadAndInit();
    await new Promise(r => setTimeout(r, 20));
    assertEqual(app2.state.settings.language, "de", "language choice survives a simulated restart");
    assertEqual(app2.state.settings.soundEffects, false, "sound-effects-off choice survives a simulated restart");
  }

  /* ---- DOM: settings Save button is a real draft/dirty flow ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    app.switchView("settings");
    app.render();
    const doc = sandbox.document;

    const saveBtn = doc._rootEl.querySelectorAll(".btn-primary")[0];
    assertEqual(saveBtn.getAttribute("disabled"), "disabled", "Save starts disabled when nothing changed");

    const langBtns = doc._rootEl.querySelectorAll(".lang-btn");
    const frBtn = langBtns.filter(b => b.textContent === "Français")[0];
    assert(!!frBtn, "French option is present in the language picker");
    frBtn.click();

    const saveBtn2 = doc._rootEl.querySelectorAll(".btn-primary")[0];
    assertEqual(saveBtn2.getAttribute("disabled"), null, "Save becomes enabled once a preference actually changed");
    assertEqual(app.state.settings.language, "en", "picking a language does not apply it until Save is pressed");

    saveBtn2.click();
    assertEqual(app.state.settings.language, "fr", "clicking Save commits the draft language");
    assertEqual(doc._rootEl.querySelectorAll(".tab")[0].textContent, "Aujourd'hui", "UI text updates immediately after saving the new language");

    const saveBtn3 = doc._rootEl.querySelectorAll(".btn-primary")[0];
    assertEqual(saveBtn3.getAttribute("disabled"), "disabled", "Save disables itself again once the draft matches the saved settings");
  }

  /* ---- DOM: sound effects toggle in Settings, persisted only after Save ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    app.switchView("settings");
    app.render();
    const doc = sandbox.document;
    assertEqual(app.state.settings.soundEffects, true, "sound effects on by default");
    const soundSwitch = doc._rootEl.querySelectorAll(".switch")[0];
    soundSwitch.click();
    assertEqual(app.state.settings.soundEffects, true, "toggling the switch is still just a draft until Save");
    doc._rootEl.querySelectorAll(".btn-primary")[0].click();
    assertEqual(app.state.settings.soundEffects, false, "Save commits the sound-effects-off draft");
  }

  /* ---- DOM: habit management now lives on the main screen, not Settings ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    app.render(); // dashboard
    const doc = sandbox.document;

    // add via the always-one-tap-away quick add
    const addLink = doc._rootEl._findAll(".text-link", []).filter(b => b.textContent.indexOf("Add habit") !== -1)[0];
    assert(!!addLink, "an 'Add habit' quick-add link is present directly on the dashboard");
    addLink.click();
    const addInput = doc._rootEl.querySelectorAll(".add-habit-row")[0].children[0];
    addInput.value = "Read 10 pages";
    doc._rootEl.querySelectorAll(".add-habit-row")[0].children[1].click();
    assertEqual(app.state.config.habits.length, 13, "adding a habit from the main screen works");
    assertEqual(app.state.config.habits[12].name, "Read 10 pages", "new habit has the entered name");

    // deletion requires entering manage mode (still main screen, not Settings)
    app.render();
    const manageLink = doc._rootEl._findAll(".text-link", []).filter(b => b.textContent === "Manage")[0];
    assert(!!manageLink, "a 'Manage' link toggles habit management inline on the dashboard");
    manageLink.click();
    const rows = doc._rootEl.querySelectorAll(".manage-row");
    assertEqual(rows.length, 13, "manage mode lists every habit, including disabled ones");
    const lastRowDeleteBtn = rows[12].children[rows[12].children.length-1];
    lastRowDeleteBtn.click(); // first click asks for confirmation
    const confirmBtn = doc._rootEl._findAll(".iconbtn", []).filter(b => b.textContent === "✕")[0];
    assert(!!confirmBtn, "delete requires an explicit confirm tap (destructive action protection)");
    confirmBtn.click();
    assertEqual(app.state.config.habits.length, 12, "confirming delete removes the habit");

    // Settings must NOT contain any habit rows anymore
    app.switchView("settings");
    app.render();
    assertEqual(doc._rootEl.querySelectorAll(".manage-row").length, 0, "Settings page no longer contains habit management");
    assertEqual(doc._rootEl.querySelectorAll(".add-habit-row").length, 0, "Settings page no longer contains the add-habit control");
  }

  /* ---- duplicate habit name is rejected, not silently added ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const before = app.state.config.habits.length;
    app.commitAddHabit("cold shower"); // case-insensitive duplicate of the default "Cold shower"
    assertEqual(app.state.config.habits.length, before, "case-insensitive duplicate habit name is rejected, not added");
  }

  /* ---- empty add is a no-op, not a crash ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const before = app.state.config.habits.length;
    app.commitAddHabit("   ");
    assertEqual(app.state.config.habits.length, before, "whitespace-only habit name is rejected");
  }

  /* ---- v1.1.0: daily quote — content completeness ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const langs = app.LANGUAGES.map(l => l.code);
    assertEqual(langs.length, 5, "still exactly 5 supported languages");
    let lengths = [];
    langs.forEach(l => {
      assert(Array.isArray(app.DAILY_QUOTES[l]), "DAILY_QUOTES has an array for " + l);
      assert(app.DAILY_QUOTES[l].length >= 25, "DAILY_QUOTES." + l + " has at least 25 entries (has " + app.DAILY_QUOTES[l].length + ")");
      lengths.push(app.DAILY_QUOTES[l].length);
    });
    assert(lengths.every(n => n === lengths[0]), "every language's quote list is the same length, so switching language keeps the same daily index");
  }

  /* ---- v1.1.0: daily quote — deterministic on local calendar date ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const n = app.DAILY_QUOTES.en.length;
    const morning = app.dailyQuoteIndex(new Date(2026, 8, 13, 0, 1, 0), n);
    const night = app.dailyQuoteIndex(new Date(2026, 8, 13, 23, 58, 0), n);
    assertEqual(morning, night, "same calendar date at different times of day yields the same quote index");

    const nextDay = app.dailyQuoteIndex(new Date(2026, 8, 14, 0, 1, 0), n);
    assert(nextDay !== morning, "the very next calendar date yields a different quote index");

    const acrossMonth = app.dailyQuoteIndex(new Date(2026, 9, 1, 12, 0, 0), n);
    assert(typeof acrossMonth === "number" && acrossMonth >= 0 && acrossMonth < n, "index stays in range across a month boundary");
  }

  /* ---- v1.1.0: daily quote — reflects the currently selected language, same concept index ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    app.state.settings.language = "en";
    const enQuote = app.dailyQuote();
    assert(app.DAILY_QUOTES.en.indexOf(enQuote) !== -1, "English quote comes from the English list");
    const idx = app.DAILY_QUOTES.en.indexOf(enQuote);

    app.state.settings.language = "tr";
    const trQuote = app.dailyQuote();
    assertEqual(app.DAILY_QUOTES.tr[idx], trQuote, "switching language immediately shows the SAME daily index, translated");
    assert(trQuote !== enQuote, "the localized quote text actually differs from the English one");

    app.state.settings.language = "xx"; // unknown/corrupted language code
    assertEqual(app.dailyQuote(), enQuote, "an unknown language code falls back to the English quote rather than crashing");
  }

  /* ---- v1.1.0: daily quote — rendered on the dashboard and updates with language ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    app.render();
    const doc = sandbox.document;
    const quoteEl = doc._rootEl.querySelector("#daily-quote");
    assert(!!quoteEl, "a #daily-quote element is present on the dashboard");
    assertEqual(quoteEl.textContent, app.dailyQuote(), "rendered quote text matches dailyQuote() for the current language");

    app.state.settings.language = "de";
    app.render();
    const quoteEl2 = doc._rootEl.querySelector("#daily-quote");
    assertEqual(quoteEl2.textContent, app.dailyQuote(), "quote re-renders in German after a language change");
  }

  /* ---- v1.1.0: brand logo with fallback ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    app.render();
    const doc = sandbox.document;
    const logo = doc._rootEl.querySelector(".brand-logo");
    assert(!!logo, "brand logo <img> is present in the top bar");
    assertEqual(logo.getAttribute("src"), "assets/icon.png", "brand logo points at the existing assets/icon.png");

    const fallback = doc._rootEl.querySelector(".brand-mark-fallback");
    assert(!!fallback, "a fallback mark element exists alongside the logo image");
    assertEqual(fallback.style.display, "none", "fallback mark starts hidden while the image is expected to load");

    logo.dispatch("error");
    assertEqual(logo.style.display, "none", "on image load failure, the broken image is hidden");
    assertEqual(fallback.style.display, "flex", "on image load failure, the fallback mark is shown instead");
  }

  /* ---- v1.1.0: 100% achievement sound — fires only on the real <100 -> 100 transition, today ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const today = app.dateStr(app.startOfDay(new Date()));
    const enabled = app.state.config.habits.filter(h => h.enabled); // 12 default habits
    assertEqual(enabled.length, 12, "sanity: 12 enabled habits for this test");

    assertEqual(app.getAchievementSoundPlayCount(), 0, "achievement sound has not played yet");

    // Check 11 of 12 — should stay below 100%, no achievement sound.
    for (let i = 0; i < 11; i++) app.toggleHabit(today, enabled[i].id, null);
    assertEqual(app.computeCompletion(today).pct, 92, "11/12 is 92%, not yet 100%");
    assertEqual(app.getAchievementSoundPlayCount(), 0, "no achievement sound before reaching 100%");

    // Check the 12th (and last) habit -> crosses from <100 to exactly 100.
    app.toggleHabit(today, enabled[11].id, null);
    assertEqual(app.computeCompletion(today).pct, 100, "12/12 is 100%");
    assertEqual(app.getAchievementSoundPlayCount(), 1, "achievement sound fires exactly once on the <100 -> 100 transition");

    // Uncheck one (drop below 100%), re-check it (back to 100%) — a genuine
    // second transition through the same mechanism should fire again,
    // same as the normal per-check sound would on every completion.
    app.toggleHabit(today, enabled[11].id, null);
    assertEqual(app.getAchievementSoundPlayCount(), 1, "dropping back below 100% does not itself play the achievement sound");
    app.toggleHabit(today, enabled[11].id, null);
    assertEqual(app.getAchievementSoundPlayCount(), 2, "re-reaching 100% from below plays the achievement sound again");
  }

  /* ---- v1.1.0: achievement sound never fires merely from loading/rendering at 100% ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const today = app.dateStr(app.startOfDay(new Date()));
    const enabled = app.state.config.habits.filter(h => h.enabled);
    const day = app.ensureDay(today);
    enabled.forEach(h => { day.habits[h.id] = true; }); // seed as already-100% data, bypassing toggleHabit
    assertEqual(app.computeCompletion(today).pct, 100, "sanity: seeded day is at 100%");
    assertEqual(app.getAchievementSoundPlayCount(), 0, "no achievement sound just from having 100% data present");

    app.render();
    app.render();
    app.render();
    assertEqual(app.getAchievementSoundPlayCount(), 0, "no achievement sound from re-rendering an already-100% day, repeatedly");
  }

  /* ---- v1.1.0: achievement sound never fires when browsing/editing a past day ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const today = app.startOfDay(new Date());
    const yesterday = app.dateStr(app.addDays(today, -1));
    const enabled = app.state.config.habits.filter(h => h.enabled);

    for (let i = 0; i < 11; i++) app.toggleHabit(yesterday, enabled[i].id, null);
    app.toggleHabit(yesterday, enabled[11].id, null); // completes yesterday to 100%
    assertEqual(app.computeCompletion(yesterday).pct, 100, "yesterday reached 100% via toggles");
    assertEqual(app.getAchievementSoundPlayCount(), 0, "completing a PAST day to 100% never plays the achievement sound");
  }

  /* ---- v1.1.0: achievement sound respects the Sound Effects preference ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const today = app.dateStr(app.startOfDay(new Date()));
    const enabled = app.state.config.habits.filter(h => h.enabled);
    app.state.settings.soundEffects = false;

    for (let i = 0; i < 12; i++) app.toggleHabit(today, enabled[i].id, null);
    assertEqual(app.computeCompletion(today).pct, 100, "today reached 100% with sound effects disabled");
    assertEqual(app.getAchievementSoundPlayCount(), 0, "achievement sound does not play while Sound Effects is off");

    app.state.settings.soundEffects = true;
    app.toggleHabit(today, enabled[0].id, null); // drop below 100%
    app.toggleHabit(today, enabled[0].id, null); // back to 100%, sound now enabled
    assertEqual(app.getAchievementSoundPlayCount(), 1, "re-enabling Sound Effects lets a fresh 100% transition play normally");
  }

  /* ==================================================================
     v1.1.1 — future-date protection
     ================================================================== */

  /* ---- isFutureDate: local-calendar-date comparison ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const today = app.startOfDay(new Date());
    const todayDs = app.dateStr(today);
    const yesterdayDs = app.dateStr(app.addDays(today, -1));
    const tomorrowDs = app.dateStr(app.addDays(today, 1));

    assertEqual(app.isFutureDate(todayDs), false, "today is not a future date");
    assertEqual(app.isFutureDate(yesterdayDs), false, "yesterday is not a future date");
    assertEqual(app.isFutureDate(tomorrowDs), true, "tomorrow IS a future date");

    // Month/year boundaries.
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth()+1, 0);
    const firstOfNextMonth = app.dateStr(app.addDays(lastDayOfMonth, 1));
    const isNextMonthFuture = app.isFutureDate(firstOfNextMonth);
    assertEqual(isNextMonthFuture, app.addDays(lastDayOfMonth,1) > today, "month-boundary date resolves consistently with a direct date comparison");
    const dec31 = new Date(today.getFullYear(), 11, 31);
    const jan1NextYear = app.dateStr(app.addDays(dec31, 1));
    assertEqual(app.isFutureDate(jan1NextYear), app.addDays(dec31,1) > today, "year-boundary date resolves consistently with a direct date comparison");

    // Accepts a Date object too, not just a "YYYY-MM-DD" string.
    assertEqual(app.isFutureDate(today), false, "isFutureDate also accepts a Date object for today");
    assertEqual(app.isFutureDate(app.addDays(today,1)), true, "isFutureDate also accepts a Date object for tomorrow");

    // Local-date comparison: a Date object at 23:59 today is still "today", not future.
    const lateToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    assertEqual(app.isFutureDate(lateToday), false, "a Date object late in the local day still counts as today, not future");
  }

  /* ---- next-day navigation never advances past today ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    const today = app.startOfDay(new Date());
    app.state.selectedDate = app.addDays(today, -3);
    app.render();
    const doc = sandbox.document;
    const nextArrow = doc._rootEl.querySelectorAll(".arrow")[1];

    nextArrow.click();
    assertEqual(app.dateStr(app.state.selectedDate), app.dateStr(app.addDays(today,-2)), "next-day arrow advances normally while still in the past");

    // Walk forward to today...
    while (app.dateStr(app.state.selectedDate) !== app.dateStr(today)) {
      doc._rootEl.querySelectorAll(".arrow")[1].click();
    }
    assertEqual(app.dateStr(app.state.selectedDate), app.dateStr(today), "sanity: now viewing today");
    const nextArrowAtToday = doc._rootEl.querySelectorAll(".arrow")[1];
    assertEqual(nextArrowAtToday.getAttribute("disabled"), "disabled", "next-day arrow is disabled once viewing today");

    // Clicking it anyway (bypassing the disabled attribute, as our DOM
    // shim does) must still not be able to move past today.
    nextArrowAtToday.click();
    assertEqual(app.dateStr(app.state.selectedDate), app.dateStr(today), "clicking the next-day arrow at today never advances into the future, even if 'disabled' were bypassed");
  }

  /* ---- History calendar: future day cells are disabled/non-selectable ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    const today = app.startOfDay(new Date());
    app.state.historyMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    app.switchView("history");
    app.render();
    const doc = sandbox.document;

    const futureCells = doc._rootEl.querySelectorAll(".future");
    assert(futureCells.length > 0, "at least one future-day calendar cell exists in the current month (today isn't the last day)");
    futureCells.forEach(c => assertEqual(c.getAttribute("disabled"), "disabled", "every future calendar cell is marked disabled"));

    const beforeDs = app.dateStr(app.state.selectedDate);
    futureCells[0].click();
    assertEqual(app.dateStr(app.state.selectedDate), beforeDs, "clicking a disabled future calendar cell does not change the selected date");

    const clickableCells = doc._rootEl.querySelectorAll(".clickable");
    assert(clickableCells.length > 0, "past/today calendar cells remain clickable");
  }

  /* ---- habit toggle cannot modify future-day state ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const tomorrow = app.dateStr(app.addDays(app.startOfDay(new Date()), 1));
    const enabled = app.state.config.habits.filter(h => h.enabled);
    app.toggleHabit(tomorrow, enabled[0].id, null);
    assertEqual(app.state.days[tomorrow], undefined, "toggling a habit on a future date writes no data for that date at all");
    assertEqual(app.getAchievementSoundPlayCount(), 0, "no sound of any kind fires from a blocked future-day toggle");
  }

  /* ---- mood cannot modify future-day state (via the real dashboard UI) ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    const tomorrow = app.addDays(app.startOfDay(new Date()), 1);
    app.state.selectedDate = tomorrow;
    app.render();
    const doc = sandbox.document;

    const moodBtns = doc._rootEl.querySelectorAll(".mood-btn");
    assert(moodBtns.length > 0, "mood buttons are still rendered (viewable) on a future day");
    moodBtns.forEach(b => assertEqual(b.getAttribute("disabled"), "disabled", "every mood button is disabled while viewing a future day"));

    moodBtns[0].click(); // bypassing 'disabled', as our shim allows
    const ds = app.dateStr(tomorrow);
    assertEqual(app.state.days[ds], undefined, "clicking a mood button on a future day still writes no data");
  }

  /* ---- journal is read-only on a future day ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    const tomorrow = app.addDays(app.startOfDay(new Date()), 1);
    app.state.selectedDate = tomorrow;
    app.render();
    const doc = sandbox.document;
    const ta = doc._rootEl.querySelector(".journal");
    assertEqual(ta.getAttribute("disabled"), "disabled", "journal textarea is disabled while viewing a future day");

    ta.value = "trying to write on a future day";
    ta.dispatch("input");
    const ds = app.dateStr(tomorrow);
    assertEqual(app.state.days[ds], undefined, "typing into the (disabled) future journal never persists any day data");
  }

  /* ---- add / rename / delete / reorder habit cannot modify state while viewing a future day ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    const tomorrow = app.addDays(app.startOfDay(new Date()), 1);
    const before = app.state.config.habits.length;

    app.state.selectedDate = tomorrow;
    app.render();
    const doc = sandbox.document;

    // "+ Add habit" / "Manage" are not even offered on a future day.
    const addLink = doc._rootEl._findAll(".text-link", []).filter(b => b.textContent.indexOf("Add habit") !== -1)[0];
    assert(!addLink, "the Add-habit quick-add link is not rendered while viewing a future day");
    const manageLink = doc._rootEl._findAll(".text-link", []).filter(b => b.textContent === "Manage")[0];
    assert(!manageLink, "the Manage link is not rendered while viewing a future day");

    // Defense-in-depth: the underlying functions themselves refuse too.
    app.commitAddHabit("Snuck-in future habit");
    assertEqual(app.state.config.habits.length, before, "commitAddHabit is a no-op while a future day is selected");

    app.moveHabit(0, 1);
    assertEqual(app.state.config.habits[0].id, app.DEFAULT_HABITS[0].id, "moveHabit is a no-op while a future day is selected");

    const originalName = app.state.config.habits[0].name;
    app.commitRename(app.state.config.habits[0].id, "Renamed while future");
    assertEqual(app.state.config.habits[0].name, originalName, "commitRename is a no-op while a future day is selected");
  }

  /* ---- past days remain fully editable (regression guard) ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const yesterday = app.dateStr(app.addDays(app.startOfDay(new Date()), -1));
    const enabled = app.state.config.habits.filter(h => h.enabled);
    app.toggleHabit(yesterday, enabled[0].id, null);
    assertEqual(app.state.days[yesterday].habits[enabled[0].id], true, "toggling a habit on a PAST date still works exactly as before");
  }

  /* ==================================================================
     v1.1.1 — mobile keyboard avoidance (pure calculation functions)
     ================================================================== */

  /* ---- isEditableField ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    const input = sandbox.document.createElement("input");
    const textarea = sandbox.document.createElement("textarea");
    const button = sandbox.document.createElement("button");
    const checkbox = sandbox.document.createElement("input");
    checkbox.type = "checkbox";
    const ce = sandbox.document.createElement("div");
    ce.isContentEditable = true;

    assert(app.isEditableField(input), "a plain <input> is an editable field");
    assert(app.isEditableField(textarea), "a <textarea> is an editable field");
    assert(!app.isEditableField(button), "a <button> is not an editable field (keyboard spacing shouldn't activate for it)");
    assert(!app.isEditableField(checkbox), "a checkbox input is not a text-entry editable field");
    assert(app.isEditableField(ce), "a contenteditable element is treated as an editable field");
    assert(!app.isEditableField(null), "isEditableField never throws on null");
  }

  /* ---- computeScrollCorrection: the actual visibility math ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    // Field fully visible inside the visual viewport -> no correction needed.
    assertEqual(app.computeScrollCorrection({top:100, bottom:150}, 0, 600, 20), 0, "a field comfortably inside the viewport needs no scroll correction");

    // Field's bottom edge is below the visible area (e.g. covered by the keyboard) -> scroll down by the exact overhang + margin.
    // visibleBottom = 0 + 400 - 20 = 380; rect.bottom=420 -> delta = 420-380 = 40
    assertEqual(app.computeScrollCorrection({top:380, bottom:420}, 0, 400, 20), 40, "scrolls down by exactly the amount the field is covered, plus margin");

    // Field is above the visible area (e.g. under a fixed topbar) -> scroll up (negative delta).
    // visibleTop+margin = 0+20 = 20; rect.top=5 -> delta = 5-20 = -15
    assertEqual(app.computeScrollCorrection({top:5, bottom:40}, 0, 400, 20), -15, "scrolls up when the field sits above the comfortable top margin");

    // A shifted visual viewport (visualViewport.offsetTop, e.g. address bar state) is respected.
    assertEqual(app.computeScrollCorrection({top:120, bottom:160}, 100, 400, 20), 0, "a nonzero visualViewport offsetTop is taken into account, not just height");
  }

  /* ---- computeKeyboardOverlap: temporary bottom scroll room ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    // Real large Android keyboard: visual viewport much shorter than layout viewport.
    assertEqual(app.computeKeyboardOverlap(800, 420, 0), 380, "a large keyboard produces a large positive overlap to reserve as scroll room");

    // Keyboard closed / no keyboard: visual and layout heights match (desktop, or keyboard dismissed).
    assertEqual(app.computeKeyboardOverlap(800, 800, 0), 0, "matching layout/visual heights (keyboard closed, or desktop) needs no reserved space");

    // Small mismatch (URL bar show/hide, rounding) is treated as noise, not a keyboard.
    assertEqual(app.computeKeyboardOverlap(800, 780, 0), 0, "a small viewport mismatch under the threshold is ignored as noise");

    // visualViewport.offsetTop is subtracted too.
    assertEqual(app.computeKeyboardOverlap(800, 500, 50), 250, "visualViewport offsetTop is accounted for in the overlap calculation");
  }

  /* ---- absence of visualViewport never throws (Node/test env, and older browsers) ---- */
  {
    let threw = false;
    try{
      const { app } = loadApp({ withArtifactStorage:false }); // sandbox has no window.visualViewport at all
      app.render();
    }catch(e){ threw = true; }
    assert(!threw, "the whole app — including keyboard-avoidance setup — loads and renders fine with no visualViewport present");
  }

  /* ---- desktop-shaped dimensions never produce keyboard spacing ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    // A typical desktop window resize (layout and visual viewport always
    // match on desktop; there's no on-screen keyboard shrinking anything).
    assertEqual(app.computeKeyboardOverlap(1080, 1080, 0), 0, "identical desktop layout/visual heights never trigger keyboard spacing");
  }

  /* ==================================================================
     v1.2.0 — PWA: manifest
     ================================================================== */
  {
    const manifestPath = require("path").join(__dirname, "..", "manifest.webmanifest");
    assert(fs.existsSync(manifestPath), "manifest.webmanifest exists at the project root");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assertEqual(manifest.name, "Habit Tracker", "manifest has the correct app name");
    assertEqual(manifest.short_name, "Habit Tracker", "manifest has the correct short_name");
    assertEqual(manifest.display, "standalone", "manifest requests standalone display");

    // GitHub Pages project sites are served from a subpath
    // (username.github.io/repo/) — start_url/scope must be relative,
    // never a leading-slash absolute path, or they'd resolve to the
    // domain root instead of the actual app folder.
    assert(!manifest.start_url.startsWith("/"), "start_url is relative, not domain-root-absolute (GitHub Pages subpath safe)");
    assert(!manifest.scope.startsWith("/"), "scope is relative, not domain-root-absolute (GitHub Pages subpath safe)");
    assert(manifest.start_url.startsWith("./"), "start_url is explicitly relative to the manifest's own location");
    assert(manifest.scope.startsWith("./"), "scope is explicitly relative to the manifest's own location");

    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, "manifest declares at least 3 icons");
    const has192 = manifest.icons.some(i => i.sizes === "192x192" && i.purpose === "any");
    const has512 = manifest.icons.some(i => i.sizes === "512x512" && i.purpose === "any");
    const hasMaskable = manifest.icons.some(i => i.sizes === "512x512" && i.purpose === "maskable");
    assert(has192, "manifest includes a 192x192 'any'-purpose icon");
    assert(has512, "manifest includes a 512x512 'any'-purpose icon");
    assert(hasMaskable, "manifest includes a 512x512 maskable icon");
    manifest.icons.forEach(i => {
      assert(!i.src.startsWith("/"), "icon src '" + i.src + "' is relative, not domain-root-absolute");
      const iconFile = require("path").join(__dirname, "..", i.src);
      assert(fs.existsSync(iconFile), "referenced icon file exists on disk: " + i.src);
    });
  }

  /* ---- index.html actually links the manifest + iOS meta tags + apple-touch-icon ---- */
  {
    const htmlPath = require("path").join(__dirname, "..", "index.html");
    const html = fs.readFileSync(htmlPath, "utf8");
    assert(/<link\s+rel="manifest"\s+href="\.\/manifest\.webmanifest"/.test(html), "index.html links manifest.webmanifest with a relative href");
    assert(/apple-mobile-web-app-capable/.test(html), "index.html sets apple-mobile-web-app-capable (iOS doesn't use the manifest for this)");
    assert(/apple-mobile-web-app-status-bar-style/.test(html), "index.html sets apple-mobile-web-app-status-bar-style");
    assert(/apple-mobile-web-app-title/.test(html), "index.html sets apple-mobile-web-app-title");
    assert(/rel="apple-touch-icon"/.test(html), "index.html links an apple-touch-icon");
    assert(/env\(safe-area-inset-top\)/.test(html), "safe-area-inset-top is used in the CSS (notch/status bar)");
    assert(/env\(safe-area-inset-bottom\)/.test(html), "safe-area-inset-bottom is used in the CSS (home indicator/nav bar)");
  }

  /* ==================================================================
     v1.2.0 — PWA: service worker (static structure, since a real
     ServiceWorker global scope isn't available under plain Node)
     ================================================================== */
  {
    const swPath = require("path").join(__dirname, "..", "sw.js");
    assert(fs.existsSync(swPath), "sw.js exists at the project root");
    const sw = fs.readFileSync(swPath, "utf8");

    assert(/CACHE_VERSION\s*=\s*"v[\d.]+"/.test(sw), "sw.js declares an explicit, versioned cache name");
    assert(/self\.addEventListener\(\s*["']install["']/.test(sw), "sw.js has an install handler");
    assert(/self\.addEventListener\(\s*["']activate["']/.test(sw), "sw.js has an activate handler");
    assert(/self\.addEventListener\(\s*["']fetch["']/.test(sw), "sw.js has a fetch handler");
    assert(/caches\.delete/.test(sw), "sw.js cleans up old caches (activate-time cache deletion logic exists)");
    assert(/skipWaiting/.test(sw) && /clients\.claim/.test(sw), "sw.js takes over promptly on update (skipWaiting + clients.claim)");

    ["./index.html", "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png"].forEach(f => {
      assert(sw.indexOf('"' + f + '"') !== -1, "sw.js precaches " + f);
    });

    // Syntax check only (a real ServiceWorker global scope — self/caches/fetch
    // as SW APIs — isn't available under Node, so we can't execute this file).
    let threw = false;
    try{ new Function(sw); }catch(e){ threw = true; }
    assert(!threw, "sw.js has valid JavaScript syntax");
  }

  /* ---- service worker registration never throws, and skips itself correctly ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    assertEqual(app.shouldSkipServiceWorkerRegistration(false, "https:"), true, "registration is skipped when serviceWorker isn't supported at all");
    assertEqual(app.shouldSkipServiceWorkerRegistration(true, "file:"), true, "registration is skipped under file:// (Electron) even if the API exists");
    assertEqual(app.shouldSkipServiceWorkerRegistration(true, "https:"), false, "registration proceeds normally for a supported browser over https");
    assertEqual(app.shouldSkipServiceWorkerRegistration(true, "http:"), false, "registration proceeds normally for a supported browser over http (e.g. local dev)");

    let threw = false;
    try{ app.registerServiceWorker(); }catch(e){ threw = true; } // no navigator/location at all in the test sandbox
    assert(!threw, "registerServiceWorker() never throws even with no navigator/location present (Node, or an old browser)");
  }

  /* ==================================================================
     v1.2.0 — PWA: install UX
     ================================================================== */

  /* ---- standalone detection ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    assertEqual(app.isStandaloneDisplay(true, false), true, "matchMedia standalone alone is enough to count as standalone");
    assertEqual(app.isStandaloneDisplay(false, true), true, "iOS navigator.standalone alone is enough to count as standalone");
    assertEqual(app.isStandaloneDisplay(false, false), false, "neither signal present -> not standalone (normal browser tab)");
    assertEqual(app.isStandaloneDisplay(true, true), true, "both signals present -> still standalone");
    // Live wrapper must never throw with no matchMedia/navigator at all (test sandbox).
    let threw = false;
    let result;
    try{ result = app.detectStandaloneDisplay(); }catch(e){ threw = true; }
    assert(!threw, "detectStandaloneDisplay() never throws with no matchMedia/navigator present");
    assertEqual(result, false, "with no matchMedia/navigator present at all, detectStandaloneDisplay() safely resolves to false");
  }

  /* ---- install button hidden when unsupported (no deferred prompt available) ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    app.__setDeferredInstallPromptForTests(null);
    app.switchView("settings");
    app.render();
    const btn = sandbox.document._rootEl.querySelector("#install-app-btn");
    assert(!btn, "no Install App button is rendered when the browser never offered an install prompt");
  }

  /* ---- install button shown when a deferred prompt IS available, and not standalone ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    let promptCalls = 0;
    app.__setDeferredInstallPromptForTests({ prompt: function(){ promptCalls++; } });
    app.switchView("settings");
    app.render();
    const btn = sandbox.document._rootEl.querySelector("#install-app-btn");
    assert(!!btn, "Install App button IS rendered once a deferred beforeinstallprompt event is available");

    btn.click();
    assertEqual(promptCalls, 1, "clicking Install calls prompt() on the deferred event exactly once");
    assertEqual(app.__getDeferredInstallPromptForTests(), null, "the deferred event is consumed (cleared) after use, so it can't be reused");
  }

  /* ---- install button hidden in standalone mode, even with a deferred prompt available ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    assertEqual(app.canShowInstallPrompt(true, true), false, "even with a deferred prompt available, standalone mode hides the install action");
    assertEqual(app.canShowInstallPrompt(true, false), true, "a deferred prompt while NOT standalone shows the install action");
    assertEqual(app.canShowInstallPrompt(false, false), false, "no deferred prompt at all means no install action, regardless of display mode");
    assertEqual(app.canShowInstallPrompt(false, true), false, "no deferred prompt and standalone -> definitely no install action");
  }

  /* ---- install prompt behavior does not repeat incorrectly ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    let promptCalls = 0;
    app.__setDeferredInstallPromptForTests({ prompt: function(){ promptCalls++; } });
    app.promptInstall();
    assertEqual(promptCalls, 1, "first promptInstall() call triggers exactly one prompt()");
    app.promptInstall(); // no deferred event left — must be a safe no-op, not a re-prompt
    assertEqual(promptCalls, 1, "calling promptInstall() again after it's already been used does not prompt a second time");
  }

  /* ==================================================================
     v1.2.0 — data compatibility: PWA additions never reset app state
     ================================================================== */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const today = app.dateStr(app.startOfDay(new Date()));
    const enabled = app.state.config.habits.filter(h => h.enabled);
    app.toggleHabit(today, enabled[0].id, null);
    const day = app.ensureDay(today);
    day.mood = "happy"; day.journal = "pre-existing data"; app.persist();

    // Simulate the kind of things v1.2.0 touches happening around it —
    // rendering Settings (which may show/hide the install row), toggling
    // standalone-detection paths, registering (a no-op in this sandbox) —
    // none of it should ever touch existing day data.
    app.switchView("settings");
    app.render();
    app.registerServiceWorker();
    app.detectStandaloneDisplay();
    app.render();

    assertEqual(app.state.days[today].habits[enabled[0].id], true, "existing habit-completion data survives PWA-related rendering/registration");
    assertEqual(app.state.days[today].mood, "happy", "existing mood data survives PWA-related rendering/registration");
    assertEqual(app.state.days[today].journal, "pre-existing data", "existing journal data survives PWA-related rendering/registration");
  }

  /* ==================================================================
     v1.2.0 — everything from v1.1.1 must still hold
     ================================================================== */

  /* ---- mobile keyboard-avoidance pure functions still behave identically ---- */
  {
    const { app, sandbox } = loadApp({ withArtifactStorage:false });
    assertEqual(app.computeKeyboardOverlap(800, 420, 0), 380, "keyboard-overlap calculation is unchanged in v1.2.0");
    assertEqual(app.computeScrollCorrection({top:380, bottom:420}, 0, 400, 20), 40, "scroll-correction calculation is unchanged in v1.2.0");
    const input = sandbox.document.createElement("input");
    assert(app.isEditableField(input), "isEditableField still recognizes text inputs in v1.2.0");
  }

  /* ---- future-date protection still holds ---- */
  {
    const { app } = loadApp({ withArtifactStorage:false });
    const tomorrow = app.dateStr(app.addDays(app.startOfDay(new Date()), 1));
    assertEqual(app.isFutureDate(tomorrow), true, "isFutureDate still correctly flags tomorrow in v1.2.0");
    const enabled = app.state.config.habits.filter(h => h.enabled);
    app.toggleHabit(tomorrow, enabled[0].id, null);
    assertEqual(app.state.days[tomorrow], undefined, "future-day protection still blocks writes in v1.2.0");
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail>0 ? 1 : 0);
}

main();
