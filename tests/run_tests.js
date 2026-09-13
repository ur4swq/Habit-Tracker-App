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

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail>0 ? 1 : 0);
}

main();
