  "use strict";

  var _jsxFileName = "/Users/masonbickers/Desktop/version1.0-app/app/(protected)/me.jsx"; // app/(protected)/me.jsx
  /* --------- date helpers --------- */
  Object.defineProperty(exports, '__esModule', {
    value: true
  });
  function _interopDefault(e) {
    return e && e.__esModule ? e : {
      default: e
    };
  }
  Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function () {
      return YouPage;
    }
  });
  var _babelRuntimeHelpersSlicedToArray = require("@babel/runtime/helpers/slicedToArray");
  var _slicedToArray = _interopDefault(_babelRuntimeHelpersSlicedToArray);
  var _babelRuntimeHelpersAsyncToGenerator = require("@babel/runtime/helpers/asyncToGenerator");
  var _asyncToGenerator = _interopDefault(_babelRuntimeHelpersAsyncToGenerator);
  var _expoVectorIcons = require("@expo/vector-icons");
  var _reactNativeAsyncStorageAsyncStorage = require("@react-native-async-storage/async-storage");
  var AsyncStorage = _interopDefault(_reactNativeAsyncStorageAsyncStorage);
  var _expoLinearGradient = require("expo-linear-gradient");
  var _expoRouter = require("expo-router");
  var _firebaseFirestore = require("firebase/firestore");
  var _react = require("react");
  var _reactNative = require("react-native");
  var _reactNativeSafeAreaContext = require("react-native-safe-area-context");
  var _reactNativeSvg = require("react-native-svg");
  var Svg = _interopDefault(_reactNativeSvg);
  var _firebaseConfig = require("../../firebaseConfig");
  var _providersThemeProvider = require("../../providers/ThemeProvider");
  var _reactJsxDevRuntime = require("react/jsx-dev-runtime");
  function startOfDay() {
    var d = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : new Date();
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function daysAgo(n) {
    var x = new Date();
    x.setDate(x.getDate() - n);
    return x;
  }
  function startOfMonth() {
    var d = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : new Date();
    var x = new Date(d);
    x.setDate(1);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function isoDateKey(d) {
    return new Date(d).toISOString().slice(0, 10);
  }
  function clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  /* --------- Strava cache helpers --------- */
  var STRAVA_CACHE_KEY = "strava_cached_activities_v1";
  function readStravaCache() {
    return _readStravaCache.apply(this, arguments);
  }
  function _readStravaCache() {
    _readStravaCache = (0, _asyncToGenerator.default)(function* () {
      try {
        var raw = yield AsyncStorage.default.getItem(STRAVA_CACHE_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.activities)) return null;
        return parsed; // { cachedAtISO, activities }
      } catch {
        return null;
      }
    });
    return _readStravaCache.apply(this, arguments);
  }
  function writeStravaCache(_x) {
    return _writeStravaCache.apply(this, arguments);
  }
  function _writeStravaCache() {
    _writeStravaCache = (0, _asyncToGenerator.default)(function* (activities) {
      try {
        var payload = {
          cachedAtISO: new Date().toISOString(),
          activities: Array.isArray(activities) ? activities : []
        };
        yield AsyncStorage.default.setItem(STRAVA_CACHE_KEY, JSON.stringify(payload));
        return payload.cachedAtISO;
      } catch {
        return "";
      }
    });
    return _writeStravaCache.apply(this, arguments);
  }
  function computeStravaDerivedStates(safeActs) {
    // Weekly summary = last 7 days
    var sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var last7 = safeActs.filter(a => {
      var d = a?.start_date ? new Date(a.start_date).getTime() : 0;
      return d >= sevenDaysAgo;
    });
    var runActs7 = last7.filter(a => a.type === "Run");
    var distanceM = 0;
    var movingSec = 0;
    runActs7.forEach(a => {
      distanceM += a.distance || 0;
      movingSec += a.moving_time || 0;
    });

    // Strength / gym sessions (approx types)
    var strengthTypes = new Set(["Workout", "WeightTraining", "Crossfit", "StrengthTraining", "GymWorkout"]);
    var strengthSec7 = 0;
    last7.forEach(a => {
      if (strengthTypes.has(a.type)) strengthSec7 += a.moving_time || 0;
    });
    var weekly = {
      runs: runActs7.length,
      workouts: last7.length,
      distanceKm: distanceM / 1000,
      timeMin: Math.round(movingSec / 60)
    };
    var strengthMinutes = Math.round(strengthSec7 / 60);

    // Recent list (top 12)
    var recentMapped = safeActs.slice(0, 12).map(a => {
      var distanceKm = (a.distance || 0) / 1000;
      var pace = distanceKm > 0 ? (a.moving_time || 0) / 60 / distanceKm : null;
      return {
        id: String(a.id),
        title: a.name || a.type || "Workout",
        distanceKm,
        paceMinPerKm: pace,
        movingTimeMin: Math.round((a.moving_time || 0) / 60),
        when: a.start_date,
        type: a.type
      };
    });

    // 7-day distance series
    var distanceByDay = {};
    last7.forEach(a => {
      if (a.type !== "Run") return;
      if (!a.start_date) return;
      var key = isoDateKey(a.start_date);
      distanceByDay[key] = (distanceByDay[key] || 0) + (a.distance || 0) / 1000;
    });
    var series7 = [];
    for (var i = 6; i >= 0; i--) {
      var d = daysAgo(i);
      var key = isoDateKey(d);
      var label = d.toLocaleDateString("en-GB", {
        weekday: "short"
      });
      series7.push({
        label,
        value: distanceByDay[key] || 0
      });
    }

    // Month summary (current month)
    var monthStart = startOfMonth(new Date()).getTime();
    var thisMonth = safeActs.filter(a => {
      var t = a?.start_date ? new Date(a.start_date).getTime() : 0;
      return t >= monthStart;
    });
    var monthRun = thisMonth.filter(a => a.type === "Run");
    var monthDistanceKm = monthRun.reduce((sum, a) => sum + (a.distance || 0), 0) / 1000;
    var monthTimeMin = Math.round(thisMonth.reduce((sum, a) => sum + (a.moving_time || 0), 0) / 60);
    var monthSummary = {
      activities: thisMonth.length,
      timeMin: monthTimeMin,
      distanceKm: monthDistanceKm
    };

    // 12-week weekly volume (run km)
    var weekKey = dt => {
      var d = new Date(dt);
      var tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      var yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      var weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
      return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    };
    var runActs12w = safeActs.filter(a => a.type === "Run");
    var byWeek = {};
    runActs12w.forEach(a => {
      if (!a.start_date) return;
      var k = weekKey(a.start_date);
      byWeek[k] = (byWeek[k] || 0) + (a.distance || 0) / 1000;
    });
    var keys = [];
    var labels = [];
    var now = new Date();
    for (var _i = 11; _i >= 0; _i--) {
      var _d = new Date(now);
      _d.setDate(_d.getDate() - _i * 7);
      var k = weekKey(_d);
      keys.push(k);
      var wkNum = k.split("-W")[1] || "";
      labels.push(`W${wkNum}`);
    }
    var weeklySeries12w = keys.map((k, idx) => ({
      label: labels[idx],
      value: byWeek[k] || 0
    }));
    return {
      weekly,
      strengthMinutes,
      recentMapped,
      distanceSeries7d: series7,
      monthSummary,
      weeklySeries12w
    };
  }

  /* ============================================================================
     ME (You) — Strava-like layout, Train-R functionality
  ============================================================================ */
  function YouPage() {
    var router = (0, _expoRouter.useRouter)();
    var _useTheme = (0, _providersThemeProvider.useTheme)(),
      colors = _useTheme.colors,
      isDark = _useTheme.isDark;
    var insets = (0, _reactNativeSafeAreaContext.useSafeAreaInsets)();
    var user = _firebaseConfig.auth.currentUser;

    // ✅ Accent rules:
    // - accentFill: neon used ONLY for fills/bars/badges
    // - accentInk: NEVER neon; used for links + “accent text”
    var accentFill = colors.accentBg || colors.sapPrimary || colors.primary || "#E6FF3B";
    var accentInk = isDark ? colors.text || "#E5E7EB" // in dark mode use normal text (not neon)
    : colors.accentText || "#3F4F00"; // in light mode use readable olive/ink

    // Tab state
    var _useState = (0, _react.useState)("progress"),
      _useState2 = (0, _slicedToArray.default)(_useState, 2),
      tab = _useState2[0],
      setTab = _useState2[1]; // "progress" | "activities"

    // Strava state
    var _useState3 = (0, _react.useState)(false),
      _useState4 = (0, _slicedToArray.default)(_useState3, 2),
      loadingStrava = _useState4[0],
      setLoadingStrava = _useState4[1];
    var _useState5 = (0, _react.useState)(""),
      _useState6 = (0, _slicedToArray.default)(_useState5, 2),
      stravaError = _useState6[0],
      setStravaError = _useState6[1];
    var _useState7 = (0, _react.useState)(false),
      _useState8 = (0, _slicedToArray.default)(_useState7, 2),
      hasToken = _useState8[0],
      setHasToken = _useState8[1];
    var _useState9 = (0, _react.useState)(""),
      _useState0 = (0, _slicedToArray.default)(_useState9, 2),
      lastSyncISO = _useState0[0],
      setLastSyncISO = _useState0[1];
    var _useState1 = (0, _react.useState)(false),
      _useState10 = (0, _slicedToArray.default)(_useState1, 2),
      hasCachedStrava = _useState10[0],
      setHasCachedStrava = _useState10[1];

    // Derived “week”
    var _useState11 = (0, _react.useState)(null),
      _useState12 = (0, _slicedToArray.default)(_useState11, 2),
      weekly = _useState12[0],
      setWeekly = _useState12[1]; // {runs, workouts, distanceKm, timeMin}
    var _useState13 = (0, _react.useState)(0),
      _useState14 = (0, _slicedToArray.default)(_useState13, 2),
      strengthMinutes = _useState14[0],
      setStrengthMinutes = _useState14[1];

    // Recent activity list (for Activities tab + preview)
    var _useState15 = (0, _react.useState)([]),
      _useState16 = (0, _slicedToArray.default)(_useState15, 2),
      recent = _useState16[0],
      setRecent = _useState16[1]; // mapped strava activities
    var _useState17 = (0, _react.useState)([]),
      _useState18 = (0, _slicedToArray.default)(_useState17, 2),
      allLoadedActivities = _useState18[0],
      setAllLoadedActivities = _useState18[1]; // raw for this view (kept for future)

    // Trends
    var _useState19 = (0, _react.useState)([]),
      _useState20 = (0, _slicedToArray.default)(_useState19, 2),
      distanceSeries7d = _useState20[0],
      setDistanceSeries7d = _useState20[1]; // (reserved for future)
    var _useState21 = (0, _react.useState)([]),
      _useState22 = (0, _slicedToArray.default)(_useState21, 2),
      weeklySeries12w = _useState22[0],
      setWeeklySeries12w = _useState22[1]; // [{label, value}]
    var _useState23 = (0, _react.useState)(null),
      _useState24 = (0, _slicedToArray.default)(_useState23, 2),
      monthSummary = _useState24[0],
      setMonthSummary = _useState24[1]; // {activities, timeMin, distanceKm}

    // Nutrition insights
    var _useState25 = (0, _react.useState)(null),
      _useState26 = (0, _slicedToArray.default)(_useState25, 2),
      foodStreak = _useState26[0],
      setFoodStreak = _useState26[1];
    var _useState27 = (0, _react.useState)(null),
      _useState28 = (0, _slicedToArray.default)(_useState27, 2),
      foodQualityScore = _useState28[0],
      setFoodQualityScore = _useState28[1];
    var _useState29 = (0, _react.useState)(false),
      _useState30 = (0, _slicedToArray.default)(_useState29, 2),
      loadingInsights = _useState30[0],
      setLoadingInsights = _useState30[1];

    // Journal
    var _useState31 = (0, _react.useState)(null),
      _useState32 = (0, _slicedToArray.default)(_useState31, 2),
      journalSettings = _useState32[0],
      setJournalSettings = _useState32[1];
    var _useState33 = (0, _react.useState)(null),
      _useState34 = (0, _slicedToArray.default)(_useState33, 2),
      journalSummary = _useState34[0],
      setJournalSummary = _useState34[1];
    var _useState35 = (0, _react.useState)(false),
      _useState36 = (0, _slicedToArray.default)(_useState35, 2),
      loadingJournal = _useState36[0],
      setLoadingJournal = _useState36[1];

    // Goals (simple — can be upgraded later)
    var _useState37 = (0, _react.useState)(30),
      _useState38 = (0, _slicedToArray.default)(_useState37, 2),
      weeklyRunGoalKm = _useState38[0],
      setWeeklyRunGoalKm = _useState38[1]; // default; we can load from Firestore later

    var displayName = user?.displayName || "Your Name";
    var email = user?.email || "you@example.com";
    var username = (0, _react.useMemo)(() => {
      var base = (displayName || email).split("@")[0];
      return "@" + String(base).trim().toLowerCase().replace(/[^\w]+/g, "");
    }, [displayName, email]);
    var initial = (0, _react.useMemo)(() => {
      var src = (displayName || email || "").trim();
      return src ? src[0].toUpperCase() : "Y";
    }, [displayName, email]);
    var s = makeStyles(colors, isDark, accentFill, accentInk);
    var onSettings = () => router.push("/settings");
    var onEditProfile = () => router.push("/profile");
    var formatPace = pace => {
      if (!pace || !Number.isFinite(pace)) return "-";
      var mins = Math.floor(pace);
      var secs = Math.round((pace - mins) * 60).toString().padStart(2, "0");
      return `${mins}:${secs}/km`;
    };
    var formatWhen = iso => {
      if (!iso) return "";
      var d = new Date(iso);
      var today = new Date();
      var diffDays = Math.floor((startOfDay(today) - startOfDay(d)) / (24 * 60 * 60 * 1000));
      if (diffDays === 0) return "Today";
      if (diffDays === 1) return "Yesterday";
      return d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short"
      });
    };

    /* ---------------- (Optional) load user preferences e.g. weekly goal ---------------- */
    (0, _react.useEffect)(() => {
      var loadPrefs = /*#__PURE__*/function () {
        var _ref = (0, _asyncToGenerator.default)(function* () {
          if (!user) return;
          try {
            var userRef = (0, _firebaseFirestore.doc)(_firebaseConfig.db, "users", user.uid);
            var snap = yield (0, _firebaseFirestore.getDoc)(userRef);
            if (!snap.exists()) return;
            var data = snap.data() || {};
            var wk = Number(data?.goals?.weeklyRunKm);
            if (Number.isFinite(wk) && wk > 0) setWeeklyRunGoalKm(wk);
          } catch {
            // ignore
          }
        });
        return function loadPrefs() {
          return _ref.apply(this, arguments);
        };
      }();
      loadPrefs();
    }, [user]);

    /* ---------------- STRAVA LOAD (shows cached data even if disconnected) ---------------- */
    (0, _react.useEffect)(() => {
      var applyActsToUI = function (safeActs) {
        var cachedAtISO = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : "";
        setAllLoadedActivities(safeActs);
        if (cachedAtISO) setLastSyncISO(cachedAtISO);
        var derived = computeStravaDerivedStates(safeActs);
        setWeekly(derived.weekly);
        setStrengthMinutes(derived.strengthMinutes);
        setRecent(derived.recentMapped);
        setDistanceSeries7d(derived.distanceSeries7d);
        setMonthSummary(derived.monthSummary);
        setWeeklySeries12w(derived.weeklySeries12w);
      };
      var loadStrava = /*#__PURE__*/function () {
        var _ref2 = (0, _asyncToGenerator.default)(function* () {
          var hadCache = false;
          try {
            setStravaError("");
            setLoadingStrava(true);

            // 1) Load cached Strava first (so you always see something)
            var cached = yield readStravaCache();
            if (cached?.activities?.length) {
              hadCache = true;
              setHasCachedStrava(true);
              applyActsToUI(cached.activities, cached.cachedAtISO || "");
            } else {
              setHasCachedStrava(false);
            }

            // 2) Try to refresh live if token exists
            var token = yield AsyncStorage.default.getItem("strava_access_token");
            if (!token) {
              setHasToken(false);

              // If there's no cache, clear UI back to "connect"
              if (!hadCache) {
                setWeekly(null);
                setRecent([]);
                setAllLoadedActivities([]);
                setDistanceSeries7d([]);
                setWeeklySeries12w([]);
                setStrengthMinutes(0);
                setMonthSummary(null);
                setLastSyncISO("");
              }
              return;
            }
            setHasToken(true);

            // Pull enough to build 12-week trends (84 days)
            var after12w = Math.floor((Date.now() - 84 * 24 * 60 * 60 * 1000) / 1000);
            var resp = yield fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&after=${after12w}`, {
              headers: {
                Authorization: `Bearer ${token}`
              }
            });
            if (!resp.ok) {
              var text = yield resp.text().catch(() => "");
              console.warn("Strava load error", `HTTP ${resp.status} ${resp.statusText || ""} ${text}`);
              setStravaError(hadCache ? "Strava refresh failed — showing cached data." : "Couldn’t load Strava. Try reconnecting in Settings.");
              return;
            }
            var activities = yield resp.json();
            var safeActs = Array.isArray(activities) ? activities : [];

            // Save to cache + update sync time
            var cachedAtISO = yield writeStravaCache(safeActs);
            setHasCachedStrava(safeActs.length > 0);
            applyActsToUI(safeActs, cachedAtISO || new Date().toISOString());
          } catch (err) {
            console.error("Strava load error", err);
            setStravaError(hadCache ? "Strava refresh failed — showing cached data." : "Couldn’t load Strava data. Try reconnecting in Settings.");
          } finally {
            setLoadingStrava(false);
          }
        });
        return function loadStrava() {
          return _ref2.apply(this, arguments);
        };
      }();
      loadStrava();
    }, []);

    /* ---------------- NUTRITION INSIGHTS (streak + quality) ---------------- */
    (0, _react.useEffect)(() => {
      var loadNutritionInsights = /*#__PURE__*/function () {
        var _ref3 = (0, _asyncToGenerator.default)(function* () {
          if (!user) return;
          try {
            setLoadingInsights(true);
            var since = startOfDay(daysAgo(13));
            var mealsRef = (0, _firebaseFirestore.collection)(_firebaseConfig.db, "users", user.uid, "meals");
            var qMeals = (0, _firebaseFirestore.query)(mealsRef, (0, _firebaseFirestore.where)("date", ">=", _firebaseFirestore.Timestamp.fromDate(since)), (0, _firebaseFirestore.orderBy)("date", "desc"));
            var snap = yield (0, _firebaseFirestore.getDocs)(qMeals);
            var daysWithMeals = new Set();
            snap.docs.forEach(docSnap => {
              var data = docSnap.data();
              var rawDate = data.date;
              if (!rawDate) return;
              var d = typeof rawDate.toDate === "function" ? rawDate.toDate() : new Date(rawDate);
              daysWithMeals.add(isoDateKey(d));
            });

            // streak from today backwards
            var streak = 0;
            for (var i = 0; i < 30; i++) {
              var d = daysAgo(i);
              var key = isoDateKey(d);
              if (daysWithMeals.has(key)) streak += 1;else break;
            }
            setFoodStreak(streak || 0);

            // placeholder quality grade (AI route can replace later)
            var grade = "C";
            var desc = "Logging is a bit on/off. Aim for more consistent days.";
            if (streak >= 10) {
              grade = "A";
              desc = "Very consistent logging. Great base for strong results.";
            } else if (streak >= 5) {
              grade = "B";
              desc = "Good streak going. Keep it rolling and you’ll be locked in.";
            }
            setFoodQualityScore({
              grade,
              desc
            });
          } catch (err) {
            console.error("Nutrition insights error", err);
            setFoodStreak(null);
            setFoodQualityScore(null);
          } finally {
            setLoadingInsights(false);
          }
        });
        return function loadNutritionInsights() {
          return _ref3.apply(this, arguments);
        };
      }();
      loadNutritionInsights();
    }, [user]);

    /* ---------------- JOURNAL SETTINGS + INSIGHTS ---------------- */
    (0, _react.useEffect)(() => {
      var loadJournal = /*#__PURE__*/function () {
        var _ref4 = (0, _asyncToGenerator.default)(function* () {
          if (!user) return;
          try {
            setLoadingJournal(true);
            var userRef = (0, _firebaseFirestore.doc)(_firebaseConfig.db, "users", user.uid);
            var userSnap = yield (0, _firebaseFirestore.getDoc)(userRef);
            if (userSnap.exists()) {
              var data = userSnap.data();
              setJournalSettings(data.journalSettings || {});
            } else {
              setJournalSettings(null);
            }
            var insightRef = (0, _firebaseFirestore.doc)(_firebaseConfig.db, "users", user.uid, "journalInsights", "weekly");
            var insightSnap = yield (0, _firebaseFirestore.getDoc)(insightRef);
            if (insightSnap.exists()) {
              var idata = insightSnap.data();
              setJournalSummary(idata.summary || null);
            } else {
              setJournalSummary(null);
            }
          } catch (e) {
            console.error("loadJournal error", e);
            setJournalSettings(null);
            setJournalSummary(null);
          } finally {
            setLoadingJournal(false);
          }
        });
        return function loadJournal() {
          return _ref4.apply(this, arguments);
        };
      }();
      loadJournal();
    }, [user]);
    var runGoalProgress = clamp01((weekly?.distanceKm || 0) / Math.max(weeklyRunGoalKm || 1, 1));
    var stravaStatusLabel = hasToken ? "Connected" : lastSyncISO ? "Disconnected (cached)" : "Not connected";
    var lastSyncLabel = lastSyncISO ? formatWhen(lastSyncISO) : "No sync yet";
    var quickActionItems = [{
      key: "start",
      icon: "play-circle",
      title: "Start session",
      subtitle: "Open recorder",
      path: "/record"
    }, {
      key: "history",
      icon: "clock",
      title: "History",
      subtitle: "Review sessions",
      path: "/history"
    }, {
      key: "nutrition",
      icon: "coffee",
      title: "Nutrition",
      subtitle: "Log food",
      path: "/nutrition"
    }, {
      key: "stats",
      icon: "bar-chart-2",
      title: "Stats",
      subtitle: "Trend overview",
      path: "/me/stats"
    }, {
      key: "prs",
      icon: "award",
      title: "PRs",
      subtitle: "Best efforts",
      path: "/me/prs"
    }];
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNativeSafeAreaContext.SafeAreaView, {
      edges: ["left", "right", "bottom"],
      style: s.safe,
      children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: s.page,
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ScrollView, {
          style: s.scroll,
          contentContainerStyle: s.scrollContent,
          showsVerticalScrollIndicator: false,
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoLinearGradient.LinearGradient, {
            colors: isDark ? [accentFill + "33", colors.bg] : [accentFill + "55", colors.bg],
            start: {
              x: 0,
              y: 0
            },
            end: {
              x: 0,
              y: 1
            },
            style: s.hero,
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: {
                paddingTop: insets.top || 8
              },
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: s.heroTopRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  onPress: () => router.back(),
                  style: s.iconButtonGhost,
                  activeOpacity: 0.8,
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "chevron-left",
                    size: 20,
                    color: colors.text
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 609,
                    columnNumber: 19
                  }, this)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 604,
                  columnNumber: 17
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: s.heroTopRight,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                    onPress: onEditProfile,
                    style: s.iconButtonGhost,
                    activeOpacity: 0.8,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "user",
                      size: 18,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 618,
                      columnNumber: 21
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 613,
                    columnNumber: 19
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                    onPress: onSettings,
                    style: s.iconButtonGhost,
                    activeOpacity: 0.8,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "settings",
                      size: 18,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 625,
                      columnNumber: 21
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 620,
                    columnNumber: 19
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 612,
                  columnNumber: 17
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 603,
                columnNumber: 15
              }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: s.heroCard,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: s.heroMainRow,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.heroAvatarWrap,
                    children: [user?.photoURL ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Image, {
                      source: {
                        uri: user.photoURL
                      },
                      style: s.heroAvatar
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 634,
                      columnNumber: 23
                    }, this) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: s.heroAvatarFallback,
                      children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                        style: s.heroAvatarInitial,
                        children: initial
                      }, void 0, false, {
                        fileName: _jsxFileName,
                        lineNumber: 637,
                        columnNumber: 25
                      }, this)
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 636,
                      columnNumber: 23
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: s.heroAvatarBorder
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 640,
                      columnNumber: 21
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 632,
                    columnNumber: 19
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.heroTextCol,
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.heroBadge,
                      children: "Account overview"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 644,
                      columnNumber: 21
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.heroName,
                      children: displayName
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 645,
                      columnNumber: 21
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.heroUsername,
                      children: username
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 646,
                      columnNumber: 21
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.heroEmail,
                      numberOfLines: 1,
                      children: email
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 647,
                      columnNumber: 21
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: s.heroActionRow,
                      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                        style: s.heroPrimaryBtn,
                        activeOpacity: 0.9,
                        onPress: onEditProfile,
                        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                          name: "user",
                          size: 16,
                          color: colors.sapOnPrimary || "#0B0B0B"
                        }, void 0, false, {
                          fileName: _jsxFileName,
                          lineNumber: 657,
                          columnNumber: 25
                        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                          style: s.heroPrimaryText,
                          children: "Profile"
                        }, void 0, false, {
                          fileName: _jsxFileName,
                          lineNumber: 662,
                          columnNumber: 25
                        }, this)]
                      }, void 0, true, {
                        fileName: _jsxFileName,
                        lineNumber: 652,
                        columnNumber: 23
                      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                        style: s.heroOutlineBtn,
                        activeOpacity: 0.9,
                        onPress: onSettings,
                        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                          name: "settings",
                          size: 16,
                          color: accentInk
                        }, void 0, false, {
                          fileName: _jsxFileName,
                          lineNumber: 670,
                          columnNumber: 25
                        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                          style: s.heroOutlineText,
                          children: "Settings"
                        }, void 0, false, {
                          fileName: _jsxFileName,
                          lineNumber: 671,
                          columnNumber: 25
                        }, this)]
                      }, void 0, true, {
                        fileName: _jsxFileName,
                        lineNumber: 665,
                        columnNumber: 23
                      }, this)]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 651,
                      columnNumber: 21
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 643,
                    columnNumber: 19
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 631,
                  columnNumber: 17
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: s.heroMetaRow,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.heroMetaPill,
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "link-2",
                      size: 13,
                      color: colors.subtext
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 679,
                      columnNumber: 21
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.heroMetaText,
                      children: ["Strava: ", stravaStatusLabel]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 680,
                      columnNumber: 21
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 678,
                    columnNumber: 19
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.heroMetaPill,
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "clock",
                      size: 13,
                      color: colors.subtext
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 683,
                      columnNumber: 21
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.heroMetaText,
                      children: ["Last sync: ", lastSyncLabel]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 684,
                      columnNumber: 21
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 682,
                    columnNumber: 19
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 677,
                  columnNumber: 17
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 630,
                columnNumber: 15
              }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: {
                  marginTop: 14
                },
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(SegmentedTabs, {
                  value: tab,
                  onChange: setTab,
                  left: {
                    key: "progress",
                    label: "Progress"
                  },
                  right: {
                    key: "activities",
                    label: "Activities"
                  },
                  accent: accentFill,
                  colors: colors,
                  isDark: isDark
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 691,
                  columnNumber: 17
                }, this)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 690,
                columnNumber: 15
              }, this)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 602,
              columnNumber: 13
            }, this)
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 592,
            columnNumber: 11
          }, this), tab === "progress" ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
            children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: [s.section, s.sectionNoBg],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/me/month"),
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "calendar",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 718,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 717,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Monthly summary"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 720,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 716,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 722,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 711,
                columnNumber: 17
              }, this), loadingStrava && !monthSummary ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 726,
                columnNumber: 19
              }, this) : monthSummary ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: {
                  marginTop: 10
                },
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: s.sectionHint,
                  children: ["You\u2019ve logged", " ", /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: {
                      fontWeight: "900",
                      color: colors.text
                    },
                    children: monthSummary.activities
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 731,
                    columnNumber: 23
                  }, this), " ", "activities so far this month."]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 729,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [s.gridRow, {
                    marginTop: 10
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MetricCard, {
                    icon: "clock",
                    label: "Active time",
                    value: `${formatHoursMin(monthSummary.timeMin)}`,
                    onPress: () => router.push("/me/month"),
                    colors: colors,
                    isDark: isDark
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 738,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MetricCard, {
                    icon: "map",
                    label: "Run distance",
                    value: `${monthSummary.distanceKm.toFixed(1)} km`,
                    onPress: () => router.push("/me/month"),
                    colors: colors,
                    isDark: isDark
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 746,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 737,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  style: s.linkRow,
                  onPress: () => router.push("/me/month"),
                  activeOpacity: 0.85,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.linkText,
                    children: "See more monthly stats"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 761,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "arrow-right",
                    size: 16,
                    color: accentInk
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 762,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 756,
                  columnNumber: 21
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 728,
                columnNumber: 19
              }, this) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionHint,
                children: hasCachedStrava ? "No cached month data available." : "Connect Strava in Settings to see your monthly summary."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 766,
                columnNumber: 19
              }, this), stravaError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionError,
                children: stravaError
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 773,
                columnNumber: 32
              }, this) : null]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 710,
              columnNumber: 15
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: [s.section, s.sectionNoBg],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/me/this-week"),
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "bar-chart-2",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 785,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 784,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "This week"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 787,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 783,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 789,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 778,
                columnNumber: 17
              }, this), loadingStrava && !weekly ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 793,
                columnNumber: 19
              }, this) : weekly ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [s.gridRow, {
                    marginTop: 10
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MetricCard, {
                    icon: "map",
                    label: "Run distance",
                    value: `${weekly.distanceKm.toFixed(1)} km`,
                    onPress: () => router.push("/me/this-week"),
                    colors: colors,
                    isDark: isDark
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 797,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MetricCard, {
                    icon: "clock",
                    label: "Run time",
                    value: `${weekly.timeMin} min`,
                    onPress: () => router.push("/me/this-week"),
                    colors: colors,
                    isDark: isDark
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 805,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 796,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: [s.gridRow, {
                    marginTop: 10
                  }],
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MetricCard, {
                    icon: "activity",
                    label: "Workouts",
                    value: `${weekly.workouts}`,
                    onPress: () => router.push("/me/this-week"),
                    colors: colors,
                    isDark: isDark
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 816,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MetricCard, {
                    icon: "zap",
                    label: "Strength",
                    value: strengthMinutes ? `${(strengthMinutes / 60).toFixed(1)} h` : "—",
                    onPress: () => router.push("/me/this-week"),
                    colors: colors,
                    isDark: isDark
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 824,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 815,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  activeOpacity: 0.9,
                  onPress: () => router.push("/me/goals"),
                  style: s.goalCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      flexDirection: "row",
                      justifyContent: "space-between"
                    },
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.goalTitle,
                      children: "Goal \xB7 Weekly run"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 845,
                      columnNumber: 25
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.goalRight,
                      children: [Math.max(0, weeklyRunGoalKm - (weekly?.distanceKm || 0)).toFixed(1), " km to go"]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 846,
                      columnNumber: 25
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 844,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.goalSub,
                    children: [(weekly?.distanceKm || 0).toFixed(1), " / ", weeklyRunGoalKm, " km"]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 852,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(ProgressBar, {
                    value: runGoalProgress,
                    accent: accentFill,
                    track: isDark ? "#18191E" : "#E6E7EC"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 856,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      flexDirection: "row",
                      justifyContent: "space-between"
                    },
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.goalMiniHint,
                      children: "Tap to manage goals"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 863,
                      columnNumber: 25
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "chevron-right",
                      size: 18,
                      color: colors.subtext
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 864,
                      columnNumber: 25
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 862,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 839,
                  columnNumber: 21
                }, this)]
              }, void 0, true) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionHint,
                children: hasCachedStrava ? "No cached weekly data available." : "Connect Strava in Settings to see your weekly stats."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 869,
                columnNumber: 19
              }, this)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 777,
              columnNumber: 15
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: [s.section, s.sectionNoBg],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/me/trends"),
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "trending-up",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 886,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 885,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Trends"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 888,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 884,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 890,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 879,
                columnNumber: 17
              }, this), loadingStrava ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 894,
                columnNumber: 19
              }, this) : weeklySeries12w.length > 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: s.sectionHint,
                  children: "Run volume over the last 12 weeks."
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 897,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(MiniBarChart, {
                  data: weeklySeries12w,
                  accent: accentFill,
                  track: isDark ? "#18191E" : "#E6E7EC",
                  textColor: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 898,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  style: s.linkRow,
                  onPress: () => router.push("/me/trends"),
                  activeOpacity: 0.85,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.linkText,
                    children: "See more trends"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 909,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "arrow-right",
                    size: 16,
                    color: accentInk
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 910,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 904,
                  columnNumber: 21
                }, this)]
              }, void 0, true) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionHint,
                children: hasToken || hasCachedStrava ? "No runs found in the last 12 weeks." : "Connect Strava to see trends."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 914,
                columnNumber: 19
              }, this)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 878,
              columnNumber: 15
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: [s.section, s.sectionNoBg],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/me/consistency"),
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "check-circle",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 931,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 930,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Consistency"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 933,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 929,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 935,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 924,
                columnNumber: 17
              }, this), loadingInsights ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 939,
                columnNumber: 19
              }, this) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  activeOpacity: 0.9,
                  onPress: () => router.push("/nutrition"),
                  style: s.consistencyCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.consistencyLeft,
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: s.consistencyBadge(accentFill),
                      children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                        style: s.consistencyBadgeText(colors),
                        children: foodStreak !== null ? foodStreak : "—"
                      }, void 0, false, {
                        fileName: _jsxFileName,
                        lineNumber: 949,
                        columnNumber: 27
                      }, this)
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 948,
                      columnNumber: 25
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                      style: {
                        flex: 1
                      },
                      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                        style: s.consistencyTitle,
                        children: "Nutrition logging streak"
                      }, void 0, false, {
                        fileName: _jsxFileName,
                        lineNumber: 954,
                        columnNumber: 27
                      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                        style: s.consistencySub,
                        children: foodStreak !== null ? `${foodStreak} day${foodStreak === 1 ? "" : "s"} in a row` : "Connect nutrition to track streaks"
                      }, void 0, false, {
                        fileName: _jsxFileName,
                        lineNumber: 955,
                        columnNumber: 27
                      }, this)]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 953,
                      columnNumber: 25
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 947,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "chevron-right",
                    size: 18,
                    color: colors.subtext
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 962,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 942,
                  columnNumber: 21
                }, this), foodQualityScore ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  activeOpacity: 0.9,
                  onPress: () => router.push("/nutrition/food-quality"),
                  style: s.foodQualityCard,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.foodQualityBadge,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.foodQualityBadgeText,
                      children: foodQualityScore.grade
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 972,
                      columnNumber: 27
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 971,
                    columnNumber: 25
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      flex: 1
                    },
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.consistencyTitle,
                      children: "Food quality"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 977,
                      columnNumber: 27
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: [s.consistencySub, {
                        color: colors.text
                      }],
                      children: foodQualityScore.desc
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 978,
                      columnNumber: 27
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 976,
                    columnNumber: 25
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "chevron-right",
                    size: 18,
                    color: colors.subtext
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 982,
                    columnNumber: 25
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 966,
                  columnNumber: 23
                }, this) : null]
              }, void 0, true)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 923,
              columnNumber: 15
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: [s.section, s.sectionNoBg],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/journal"),
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "book-open",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 998,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 997,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Journal"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1000,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 996,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1002,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 991,
                columnNumber: 17
              }, this), loadingJournal ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1006,
                columnNumber: 19
              }, this) : journalSettings?.enabled ? journalSummary ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/journal/insights"),
                style: s.journalCard,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: s.journalTitle,
                  children: "This week\u2019s insight"
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1014,
                  columnNumber: 23
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: s.journalBody,
                  children: journalSummary
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1015,
                  columnNumber: 23
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    marginTop: 10,
                    flexDirection: "row",
                    justifyContent: "space-between"
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.goalMiniHint,
                    children: "Tap to open insights"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1023,
                    columnNumber: 25
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "chevron-right",
                    size: 18,
                    color: colors.subtext
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1024,
                    columnNumber: 25
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1016,
                  columnNumber: 23
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1009,
                columnNumber: 21
              }, this) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: s.sectionHint,
                  children: "Journal insights are on. Log a few days and we\u2019ll start surfacing patterns."
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1029,
                  columnNumber: 23
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    gap: 10,
                    marginTop: 10
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                    style: [s.actionPill, {
                      flex: 1,
                      backgroundColor: accentFill
                    }],
                    activeOpacity: 0.9,
                    onPress: () => router.push("/journal/check-in"),
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "edit-3",
                      size: 16,
                      color: colors.sapOnPrimary || "#0B0B0B"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1038,
                      columnNumber: 27
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: [s.actionPillText, {
                        color: colors.sapOnPrimary || "#0B0B0B"
                      }],
                      children: "Today\u2019s check-in"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1043,
                      columnNumber: 27
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 1033,
                    columnNumber: 25
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                    style: [s.actionPill, {
                      flex: 1,
                      backgroundColor: colors.card
                    }],
                    activeOpacity: 0.9,
                    onPress: () => router.push("/journal/history"),
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "list",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1058,
                      columnNumber: 27
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: [s.actionPillText, {
                        color: colors.text,
                        textTransform: "none"
                      }],
                      children: "View journal"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1059,
                      columnNumber: 27
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 1053,
                    columnNumber: 25
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1032,
                  columnNumber: 23
                }, this)]
              }, void 0, true) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                  style: s.sectionHint,
                  children: "Turn daily notes into insights on mood, recovery and training focus."
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1073,
                  columnNumber: 21
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  style: [s.actionPill, {
                    marginTop: 10,
                    backgroundColor: accentFill
                  }],
                  activeOpacity: 0.9,
                  onPress: () => router.push("/journal/setup"),
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "book",
                    size: 16,
                    color: colors.sapOnPrimary || "#0B0B0B"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1081,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: [s.actionPillText, {
                      color: colors.sapOnPrimary || "#0B0B0B"
                    }],
                    children: "Set up journal insights"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1082,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1076,
                  columnNumber: 21
                }, this)]
              }, void 0, true)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 990,
              columnNumber: 15
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: s.section,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => setTab("activities"),
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "activity",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1104,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1103,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Recent activity"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1106,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1102,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1108,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1097,
                columnNumber: 17
              }, this), loadingStrava && recent.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1112,
                columnNumber: 19
              }, this) : recent.length > 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [recent.slice(0, 3).map(a => /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    marginTop: 8
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(ActivityItem, {
                    title: a.title,
                    meta: `${a.distanceKm.toFixed(1)} km • ${a.movingTimeMin} min${a.paceMinPerKm ? ` • ${formatPace(a.paceMinPerKm)}` : ""}`,
                    when: formatWhen(a.when),
                    icon: a.type === "Run" ? "activity" : "zap",
                    colors: colors,
                    isDark: isDark,
                    onPress: () => router.push(`/me/activity/${a.id}`)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1117,
                    columnNumber: 25
                  }, this)
                }, a.id, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1116,
                  columnNumber: 23
                }, this)), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  style: s.linkRow,
                  onPress: () => setTab("activities"),
                  activeOpacity: 0.85,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.linkText,
                    children: "View all activities"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1135,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "arrow-right",
                    size: 16,
                    color: accentInk
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1136,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1130,
                  columnNumber: 21
                }, this)]
              }, void 0, true) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionHint,
                children: hasCachedStrava ? "No cached activities to show." : hasToken ? "No Strava activities found recently." : "Connect Strava in Settings to see activity."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1140,
                columnNumber: 19
              }, this)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1096,
              columnNumber: 15
            }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: [s.section, {
                marginBottom: 24
              }],
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: s.sectionHeaderRow,
                children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "zap",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1155,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1154,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Quick actions"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1157,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1153,
                  columnNumber: 19
                }, this)
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1152,
                columnNumber: 17
              }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: s.quickActionsGrid,
                children: quickActionItems.map((item, idx) => /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(ActionTile, {
                  icon: item.icon,
                  title: item.title,
                  subtitle: item.subtitle,
                  onPress: () => router.push(item.path),
                  colors: colors,
                  isDark: isDark,
                  accentFill: accentFill,
                  accentInk: accentInk,
                  style: [s.quickActionTile, quickActionItems.length % 2 === 1 && idx === quickActionItems.length - 1 ? s.quickActionTileWide : null]
                }, item.key, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1163,
                  columnNumber: 21
                }, this))
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1161,
                columnNumber: 17
              }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                activeOpacity: 0.9,
                onPress: () => router.push("/settings"),
                style: s.dataSourceCard,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "link",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1192,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1191,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: {
                      flex: 1
                    },
                    children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.consistencyTitle,
                      children: "Data sources"
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1195,
                      columnNumber: 23
                    }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                      style: s.consistencySub,
                      children: ["Strava: ", stravaStatusLabel, " \xB7 last sync ", lastSyncLabel]
                    }, void 0, true, {
                      fileName: _jsxFileName,
                      lineNumber: 1196,
                      columnNumber: 23
                    }, this)]
                  }, void 0, true, {
                    fileName: _jsxFileName,
                    lineNumber: 1194,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1190,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                  name: "chevron-right",
                  size: 18,
                  color: colors.subtext
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1201,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1185,
                columnNumber: 17
              }, this)]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1151,
              columnNumber: 15
            }, this)]
          }, void 0, true) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
            children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
              style: s.section,
              children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                style: s.sectionHeaderRow,
                children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8
                  },
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                    style: s.sectionIcon,
                    children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                      name: "list",
                      size: 16,
                      color: colors.text
                    }, void 0, false, {
                      fileName: _jsxFileName,
                      lineNumber: 1212,
                      columnNumber: 23
                    }, this)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1211,
                    columnNumber: 21
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.sectionTitle,
                    children: "Activities"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1214,
                    columnNumber: 21
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1210,
                  columnNumber: 19
                }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  onPress: () => router.push("/record"),
                  style: s.addBtn,
                  activeOpacity: 0.85,
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "plus",
                    size: 16,
                    color: colors.text
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1222,
                    columnNumber: 21
                  }, this)
                }, void 0, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1217,
                  columnNumber: 19
                }, this)]
              }, void 0, true, {
                fileName: _jsxFileName,
                lineNumber: 1209,
                columnNumber: 17
              }, this), loadingStrava && recent.length === 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(LoaderRow, {
                s: s
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1227,
                columnNumber: 19
              }, this) : recent.length > 0 ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactJsxDevRuntime.Fragment, {
                children: [recent.map(a => /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
                  style: {
                    marginTop: 10
                  },
                  children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(ActivityItem, {
                    title: a.title,
                    meta: `${a.distanceKm.toFixed(1)} km • ${a.movingTimeMin} min${a.paceMinPerKm ? ` • ${formatPace(a.paceMinPerKm)}` : ""}`,
                    when: formatWhen(a.when),
                    icon: a.type === "Run" ? "activity" : "zap",
                    colors: colors,
                    isDark: isDark,
                    onPress: () => router.push(`/me/activity/${a.id}`)
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1232,
                    columnNumber: 25
                  }, this)
                }, a.id, false, {
                  fileName: _jsxFileName,
                  lineNumber: 1231,
                  columnNumber: 23
                }, this)), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
                  style: s.linkRow,
                  onPress: () => router.push("/history"),
                  activeOpacity: 0.85,
                  children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                    style: s.linkText,
                    children: "Open full history"
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1251,
                    columnNumber: 23
                  }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
                    name: "arrow-right",
                    size: 16,
                    color: accentInk
                  }, void 0, false, {
                    fileName: _jsxFileName,
                    lineNumber: 1252,
                    columnNumber: 23
                  }, this)]
                }, void 0, true, {
                  fileName: _jsxFileName,
                  lineNumber: 1246,
                  columnNumber: 21
                }, this)]
              }, void 0, true) : /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionHint,
                children: hasCachedStrava ? "No cached activities to show." : hasToken ? "No activities found. Record a session to get started." : "Connect Strava in Settings to import your activities."
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1256,
                columnNumber: 19
              }, this), stravaError ? /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
                style: s.sectionError,
                children: stravaError
              }, void 0, false, {
                fileName: _jsxFileName,
                lineNumber: 1265,
                columnNumber: 32
              }, this) : null]
            }, void 0, true, {
              fileName: _jsxFileName,
              lineNumber: 1208,
              columnNumber: 15
            }, this)
          }, void 0, false)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 584,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 583,
        columnNumber: 7
      }, this)
    }, void 0, false, {
      fileName: _jsxFileName,
      lineNumber: 582,
      columnNumber: 5
    }, this);
  }

  /* ============================================================================
     Components
  ============================================================================ */
  function SegmentedTabs(_ref5) {
    var value = _ref5.value,
      onChange = _ref5.onChange,
      left = _ref5.left,
      right = _ref5.right,
      accent = _ref5.accent,
      colors = _ref5.colors,
      isDark = _ref5.isDark;
    var activeBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)";
    var track = isDark ? "#0E1015" : "#FFFFFF";
    var border = isDark ? "rgba(255,255,255,0.14)" : "#D7DBE3";
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: {
        backgroundColor: track,
        borderRadius: 999,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: border,
        padding: 4,
        flexDirection: "row",
        gap: 6
      },
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
        activeOpacity: 0.9,
        onPress: () => onChange(left.key),
        style: {
          flex: 1,
          borderRadius: 999,
          paddingVertical: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: value === left.key ? activeBg : "transparent",
          borderWidth: value === left.key ? 1 : 0,
          borderColor: value === left.key ? accent : "transparent"
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: {
            fontSize: 13,
            fontWeight: "700",
            letterSpacing: 0.1,
            color: value === left.key ? colors.text : colors.subtext
          },
          children: left.label
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1310,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1296,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
        activeOpacity: 0.9,
        onPress: () => onChange(right.key),
        style: {
          flex: 1,
          borderRadius: 999,
          paddingVertical: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: value === right.key ? activeBg : "transparent",
          borderWidth: value === right.key ? 1 : 0,
          borderColor: value === right.key ? accent : "transparent"
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: {
            fontSize: 13,
            fontWeight: "700",
            letterSpacing: 0.1,
            color: value === right.key ? colors.text : colors.subtext
          },
          children: right.label
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1336,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1322,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 1285,
      columnNumber: 5
    }, this);
  }
  function MetricCard(_ref6) {
    var icon = _ref6.icon,
      label = _ref6.label,
      value = _ref6.value,
      onPress = _ref6.onPress,
      colors = _ref6.colors,
      isDark = _ref6.isDark;
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
      activeOpacity: 0.9,
      onPress: onPress,
      style: {
        flex: 1,
        backgroundColor: isDark ? "#11141B" : "#F8FAFC",
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: isDark ? "rgba(255,255,255,0.12)" : "#DCE1EA"
      },
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          width: 28,
          height: 28,
          borderRadius: 12,
          backgroundColor: isDark ? "#18191E" : "#E6E7EC",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
          name: icon,
          size: 16,
          color: colors.text
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1377,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1366,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
        style: {
          fontSize: 18,
          fontWeight: "800",
          color: colors.text
        },
        children: value
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1379,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
        style: {
          fontSize: 12,
          color: colors.subtext,
          marginTop: 2,
          fontWeight: "600"
        },
        children: label
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1382,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 1353,
      columnNumber: 5
    }, this);
  }
  function ProgressBar(_ref7) {
    var value = _ref7.value,
      accent = _ref7.accent,
      track = _ref7.track;
    var pct = clamp01(value);
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: {
        height: 10,
        borderRadius: 999,
        backgroundColor: track,
        overflow: "hidden",
        marginTop: 10,
        marginBottom: 10
      },
      children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          width: `${pct * 100}%`,
          height: "100%",
          backgroundColor: accent
        }
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1402,
        columnNumber: 7
      }, this)
    }, void 0, false, {
      fileName: _jsxFileName,
      lineNumber: 1392,
      columnNumber: 5
    }, this);
  }
  function MiniBarChart(_ref8) {
    var data = _ref8.data,
      accent = _ref8.accent,
      track = _ref8.track,
      textColor = _ref8.textColor;
    var width = 340;
    var height = 120;
    var padX = 10;
    var padY = 14;
    var values = data.map(d => Number(d.value || 0));
    var maxV = Math.max(...values, 1);
    var barCount = Math.max(data.length, 1);
    var innerW = width - padX * 2;
    var gap = 6;
    var barW = Math.max(6, (innerW - gap * (barCount - 1)) / barCount);
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: {
        marginTop: 12
      },
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: track,
          paddingVertical: 8
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(Svg.default, {
          width: "100%",
          height: height,
          viewBox: `0 0 ${width} ${height}`,
          children: data.map((d, i) => {
            var v = Number(d.value || 0);
            var h = (height - padY * 2) * v / maxV;
            var x = padX + i * (barW + gap);
            var y = height - padY - h;
            return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNativeSvg.Rect, {
              x: x,
              y: y,
              width: barW,
              height: h,
              rx: 6,
              ry: 6,
              fill: accent,
              opacity: 0.9
            }, `${d.label}-${i}`, false, {
              fileName: _jsxFileName,
              lineNumber: 1444,
              columnNumber: 15
            }, this);
          })
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1437,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1429,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 8,
          paddingHorizontal: 2
        },
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: {
            fontSize: 11,
            color: textColor
          },
          children: data[0]?.label
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1468,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: {
            fontSize: 11,
            color: textColor
          },
          children: data[data.length - 1]?.label
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1469,
          columnNumber: 9
        }, this)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1460,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 1428,
      columnNumber: 5
    }, this);
  }
  function ActivityItem(_ref9) {
    var title = _ref9.title,
      meta = _ref9.meta,
      when = _ref9.when,
      icon = _ref9.icon,
      colors = _ref9.colors,
      isDark = _ref9.isDark,
      onPress = _ref9.onPress;
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
      onPress: onPress,
      activeOpacity: 0.85,
      children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: isDark ? "#11141B" : "#F8FAFC",
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderRadius: 14,
          borderWidth: _reactNative.StyleSheet.hairlineWidth,
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "#DCE1EA"
        },
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: {
            width: 38,
            height: 38,
            borderRadius: 14,
            backgroundColor: isDark ? "#18191E" : "#E6E7EC",
            alignItems: "center",
            justifyContent: "center"
          },
          children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
            name: icon,
            size: 18,
            color: colors.text
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1503,
            columnNumber: 11
          }, this)
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1493,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
          style: {
            flex: 1
          },
          children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: {
              fontWeight: "900",
              color: colors.text,
              fontSize: 14
            },
            children: title
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1506,
            columnNumber: 11
          }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
            style: {
              fontSize: 12,
              color: colors.subtext,
              marginTop: 3
            },
            children: meta
          }, void 0, false, {
            fileName: _jsxFileName,
            lineNumber: 1509,
            columnNumber: 11
          }, this)]
        }, void 0, true, {
          fileName: _jsxFileName,
          lineNumber: 1505,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: {
            fontSize: 12,
            color: colors.subtext
          },
          children: when
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1513,
          columnNumber: 9
        }, this)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1480,
        columnNumber: 7
      }, this)
    }, void 0, false, {
      fileName: _jsxFileName,
      lineNumber: 1479,
      columnNumber: 5
    }, this);
  }
  function ActionTile(_ref0) {
    var icon = _ref0.icon,
      title = _ref0.title,
      subtitle = _ref0.subtitle,
      onPress = _ref0.onPress,
      colors = _ref0.colors,
      isDark = _ref0.isDark,
      accentFill = _ref0.accentFill,
      accentInk = _ref0.accentInk,
      style = _ref0.style;
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.TouchableOpacity, {
      activeOpacity: 0.9,
      onPress: onPress,
      style: [{
        backgroundColor: isDark ? "#11141B" : "#F8FAFC",
        borderRadius: 16,
        padding: 14,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: isDark ? "rgba(255,255,255,0.12)" : "#DCE1EA"
      }, style],
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          width: 34,
          height: 34,
          borderRadius: 14,
          backgroundColor: isDark ? "#18191E" : "#E6E7EC",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 10
        },
        children: /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
          name: icon,
          size: 18,
          color: colors.text
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1556,
          columnNumber: 9
        }, this)
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1545,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
        style: {
          fontSize: 14,
          fontWeight: "900",
          color: colors.text
        },
        children: title
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1559,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
        style: {
          marginTop: 3,
          fontSize: 12,
          color: colors.subtext
        },
        children: subtitle
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1562,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
        style: {
          marginTop: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 6
        },
        children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
          style: {
            fontWeight: "800",
            color: accentInk,
            fontSize: 12
          },
          children: "Open"
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1570,
          columnNumber: 9
        }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_expoVectorIcons.Feather, {
          name: "arrow-right",
          size: 16,
          color: accentInk
        }, void 0, false, {
          fileName: _jsxFileName,
          lineNumber: 1571,
          columnNumber: 9
        }, this)]
      }, void 0, true, {
        fileName: _jsxFileName,
        lineNumber: 1567,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 1531,
      columnNumber: 5
    }, this);
  }
  function LoaderRow(_ref1) {
    var s = _ref1.s;
    return /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.View, {
      style: {
        paddingVertical: 14
      },
      children: [/*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.ActivityIndicator, {}, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1580,
        columnNumber: 7
      }, this), /*#__PURE__*/(0, _reactJsxDevRuntime.jsxDEV)(_reactNative.Text, {
        style: s.loadingText,
        children: "Loading\u2026"
      }, void 0, false, {
        fileName: _jsxFileName,
        lineNumber: 1581,
        columnNumber: 7
      }, this)]
    }, void 0, true, {
      fileName: _jsxFileName,
      lineNumber: 1579,
      columnNumber: 5
    }, this);
  }
  function formatHoursMin(totalMin) {
    var m = Math.max(0, Number(totalMin || 0));
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (h <= 0) return `${r}m`;
    return `${h}h ${r}m`;
  }

  /* ============================================================================
     Styles
  ============================================================================ */
  function makeStyles(colors, isDark, accentFill, accentInk) {
    var cardBg = isDark ? "#12141A" : colors.sapSilverLight || "#F3F4F6";
    var panelBg = isDark ? "#0E1015" : "#FFFFFF";
    var borderSoft = isDark ? "rgba(255,255,255,0.12)" : colors.sapSilverMedium || colors.border;
    var borderHard = isDark ? "rgba(255,255,255,0.18)" : "#D7DBE3";
    return _reactNative.StyleSheet.create({
      safe: {
        flex: 1,
        backgroundColor: colors.bg || (isDark ? "#050506" : "#F5F5F7")
      },
      page: {
        flex: 1
      },
      scroll: {
        flex: 1
      },
      scrollContent: {
        flexGrow: 1,
        paddingBottom: 108
      },
      hero: {
        paddingHorizontal: 18,
        paddingTop: 0,
        paddingBottom: 8
      },
      heroTopRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 10
      },
      iconButtonGhost: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: panelBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft
      },
      heroTopRight: {
        flexDirection: "row",
        gap: 8,
        alignItems: "center"
      },
      heroCard: {
        borderRadius: 0,
        backgroundColor: "transparent",
        borderWidth: 0,
        borderColor: "transparent",
        paddingHorizontal: 0,
        paddingVertical: 4,
        shadowColor: "transparent",
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: {
          width: 0,
          height: 0
        },
        ..._reactNative.Platform.select({
          android: {
            elevation: 0
          }
        })
      },
      heroMainRow: {
        flexDirection: "row",
        alignItems: "center"
      },
      heroAvatarWrap: {
        marginRight: 14
      },
      heroAvatar: {
        width: 76,
        height: 76,
        borderRadius: 18
      },
      heroAvatarFallback: {
        width: 76,
        height: 76,
        borderRadius: 18,
        backgroundColor: cardBg,
        alignItems: "center",
        justifyContent: "center"
      },
      heroAvatarInitial: {
        fontSize: 30,
        fontWeight: "900",
        color: colors.text
      },
      heroAvatarBorder: {
        position: "absolute",
        inset: 0,
        borderRadius: 18,
        borderWidth: 1.5,
        borderColor: isDark ? `${accentFill}AA` : `${accentFill}99`
      },
      heroTextCol: {
        flex: 1
      },
      heroBadge: {
        fontSize: 11,
        fontWeight: "800",
        color: colors.subtextSoft || colors.subtext,
        letterSpacing: 0.2,
        marginBottom: 2
      },
      heroName: {
        fontSize: 22,
        fontWeight: "800",
        color: colors.text
      },
      heroUsername: {
        fontSize: 13,
        color: colors.subtext,
        marginTop: 2
      },
      heroEmail: {
        fontSize: 12,
        color: colors.subtext,
        marginTop: 2
      },
      heroActionRow: {
        marginTop: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10
      },
      heroPrimaryBtn: {
        flex: 1,
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: accentFill,
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 10,
        shadowOffset: {
          width: 0,
          height: 6
        },
        ..._reactNative.Platform.select({
          android: {
            elevation: 2
          }
        })
      },
      heroPrimaryText: {
        color: colors.sapOnPrimary || "#0B0B0B",
        fontWeight: "800",
        fontSize: 13,
        letterSpacing: 0.1
      },
      heroOutlineBtn: {
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 999,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderHard,
        backgroundColor: cardBg
      },
      heroOutlineText: {
        fontSize: 13,
        fontWeight: "800",
        color: accentInk,
        letterSpacing: 0.1
      },
      heroMetaRow: {
        marginTop: 12,
        flexDirection: "row",
        gap: 8,
        flexWrap: "wrap"
      },
      heroMetaPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft,
        paddingHorizontal: 10,
        paddingVertical: 7
      },
      heroMetaText: {
        fontSize: 11,
        fontWeight: "700",
        color: colors.text
      },
      section: {
        marginHorizontal: 18,
        marginTop: 14,
        borderRadius: 18,
        backgroundColor: panelBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft,
        paddingHorizontal: 14,
        paddingVertical: 14
      },
      sectionNoBg: {
        backgroundColor: "transparent",
        borderWidth: 0,
        borderColor: "transparent",
        paddingHorizontal: 0,
        paddingVertical: 0
      },
      sectionHeaderRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between"
      },
      sectionIcon: {
        width: 28,
        height: 28,
        borderRadius: 12,
        backgroundColor: cardBg,
        alignItems: "center",
        justifyContent: "center"
      },
      sectionTitle: {
        fontSize: 15,
        fontWeight: "800",
        color: colors.text,
        letterSpacing: 0.1
      },
      sectionHint: {
        marginTop: 10,
        color: colors.subtext,
        fontSize: 13,
        lineHeight: 18
      },
      sectionError: {
        marginTop: 8,
        color: colors.danger || "#EF4444",
        fontSize: 12
      },
      loadingText: {
        marginTop: 8,
        textAlign: "center",
        color: colors.subtext,
        fontSize: 12
      },
      gridRow: {
        flexDirection: "row",
        gap: 10
      },
      linkRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 12
      },
      linkText: {
        fontWeight: "700",
        color: accentInk,
        fontSize: 13,
        letterSpacing: 0.1
      },
      goalCard: {
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 18,
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft
      },
      goalTitle: {
        fontSize: 13,
        fontWeight: "800",
        color: colors.text
      },
      goalRight: {
        fontSize: 12,
        fontWeight: "800",
        color: colors.subtext
      },
      goalSub: {
        marginTop: 6,
        fontSize: 12,
        color: colors.subtext
      },
      goalMiniHint: {
        fontSize: 12,
        color: colors.subtext,
        fontWeight: "700"
      },
      consistencyCard: {
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 18,
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between"
      },
      consistencyLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        flex: 1
      },
      consistencyBadge: accentColor => ({
        width: 44,
        height: 44,
        borderRadius: 16,
        backgroundColor: accentColor,
        alignItems: "center",
        justifyContent: "center"
      }),
      consistencyBadgeText: c => ({
        fontWeight: "900",
        fontSize: 16,
        color: c.sapOnPrimary || "#0B0B0B"
      }),
      consistencyTitle: {
        fontSize: 13,
        fontWeight: "900",
        color: colors.text
      },
      consistencySub: {
        marginTop: 2,
        fontSize: 12,
        color: colors.subtext,
        lineHeight: 16
      },
      foodQualityCard: {
        marginTop: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 18,
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft,
        flexDirection: "row",
        alignItems: "center",
        gap: 10
      },
      foodQualityBadge: {
        width: 34,
        height: 34,
        borderRadius: 14,
        backgroundColor: colors.sapPrimary || accentFill,
        alignItems: "center",
        justifyContent: "center"
      },
      foodQualityBadgeText: {
        fontWeight: "900",
        fontSize: 16,
        color: colors.sapOnPrimary || "#0B0B0B"
      },
      journalCard: {
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 18,
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft
      },
      journalTitle: {
        fontSize: 14,
        fontWeight: "800",
        color: colors.text,
        marginBottom: 6
      },
      journalBody: {
        fontSize: 13,
        color: colors.subtext,
        lineHeight: 18
      },
      actionPill: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 11,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft,
        shadowColor: "#000",
        shadowOpacity: isDark ? 0.12 : 0.08,
        shadowRadius: 10,
        shadowOffset: {
          width: 0,
          height: 6
        },
        ..._reactNative.Platform.select({
          android: {
            elevation: 1
          }
        })
      },
      actionPillText: {
        fontSize: 13,
        fontWeight: "800",
        letterSpacing: 0.1
      },
      dataSourceCard: {
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 18,
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between"
      },
      quickActionsGrid: {
        marginTop: 10,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10
      },
      quickActionTile: {
        width: "48%"
      },
      quickActionTileWide: {
        width: "100%"
      },
      addBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: cardBg,
        borderWidth: _reactNative.StyleSheet.hairlineWidth,
        borderColor: borderSoft
      }
    });
  }
