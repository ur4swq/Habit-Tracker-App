// Extracts the <script> contents of ../index.html and injects a small
// test hook exposing internal state/functions, so the real app logic
// can be exercised directly under Node (no browser needed).
const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("no <script> block found in index.html");
let code = m[1];

const marker = '/* ---------------- init ---------------- */\n  loadAndInit();';
if (!code.includes(marker)) throw new Error("init marker not found — index.html structure changed");

const hook = `
  window.__APP__ = {
    state: state, computeCompletion: computeCompletion, currentStreak: currentStreak,
    bestStreakAndStats: bestStreakAndStats, computeInsight: computeInsight, dateStr: dateStr,
    parseDateStr: parseDateStr, addDays: addDays, startOfDay: startOfDay, ensureDay: ensureDay,
    toggleHabit: toggleHabit, StorageLayer: StorageLayer, MOODS: MOODS,
    MOOD_ID_MIGRATIONS: MOOD_ID_MIGRATIONS, migrateMoodIds: migrateMoodIds, persist: persist,
    loadAndInit: loadAndInit, render: render, formatDisplayDate: formatDisplayDate,
    DEFAULT_HABITS: DEFAULT_HABITS, t: t, commitAddHabit: commitAddHabit, switchView: switchView,
    sanitizeSettings: sanitizeSettings, LANGUAGES: LANGUAGES,
    DAILY_QUOTES: DAILY_QUOTES, dailyQuoteIndex: dailyQuoteIndex, dailyQuote: dailyQuote,
    playAchievementSound: playAchievementSound,
    getAchievementSoundPlayCount: function(){ return achievementSoundPlayCount; },
    isFutureDate: isFutureDate, isSameDay: isSameDay, moveHabit: moveHabit, commitRename: commitRename,
    isEditableField: isEditableField, computeScrollCorrection: computeScrollCorrection,
    computeKeyboardOverlap: computeKeyboardOverlap,
    isStandaloneDisplay: isStandaloneDisplay, detectStandaloneDisplay: detectStandaloneDisplay,
    canShowInstallPrompt: canShowInstallPrompt, promptInstall: promptInstall,
    shouldSkipServiceWorkerRegistration: shouldSkipServiceWorkerRegistration,
    registerServiceWorker: registerServiceWorker,
    __setDeferredInstallPromptForTests: function(v){ deferredInstallPromptEvent = v; },
    __getDeferredInstallPromptForTests: function(){ return deferredInstallPromptEvent; }
  };
` + marker;

code = code.replace(marker, hook);
fs.writeFileSync(path.join(__dirname, "harness-script.js"), code);
console.log("harness rebuilt from index.html,", code.length, "bytes");
