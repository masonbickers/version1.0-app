// app/(protected)/_layout.jsx
import { LinearGradient } from "expo-linear-gradient";
import { doc, getDoc } from "firebase/firestore";
import {
  Redirect,
  Slot,
  useRootNavigationState,
  useSegments,
} from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import Footer from "../../components/Footer";

export default function ProtectedLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const nav = useRootNavigationState();
  const segments = useSegments();
  const [deadman, setDeadman] = useState(false);
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [welcomeLoading, setWelcomeLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDeadman(true), 6000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let active = true;

    if (!user?.uid) {
      setNeedsWelcome(false);
      setWelcomeLoading(false);
      return () => {
        active = false;
      };
    }

    setWelcomeLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const welcomeSeen = snap.exists() ? snap.data()?.welcomeSeen : undefined;
        if (active) {
          // only explicit false should trigger onboarding
          setNeedsWelcome(welcomeSeen === false);
        }
      } catch (e) {
        console.warn("welcome check failed:", e?.message || e);
        if (active) setNeedsWelcome(false);
      } finally {
        if (active) setWelcomeLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user?.uid]);

  const isWelcomeRoute =
    segments?.[0] === "(protected)" && segments?.[1] === "welcome";

  const isTrainCreateFlow =
    segments?.[0] === "(protected)" &&
    ((segments?.[1] === "train" &&
      (segments?.[2] === "create-home" ||
        segments?.[2] === "create" ||
        segments?.[2] === "create-workout")) ||
      (segments?.[1] === "training" && segments?.[2] === "create"));

  // ✅ decide which routes should NOT show the footer
  const hideFooter = useMemo(() => {
    // segments example:
    // ["(protected)", "nutrition", "today"]
    const s0 = segments?.[0];
    const s1 = segments?.[1];
    const s2 = segments?.[2];

    // Hide footer on: /(protected)/train/onboarding
    const isTrainOnboarding =
      s0 === "(protected)" && s1 === "train" && s2 === "onboarding";

    // Optional: hide on any other onboarding flows you add later
    const isAnyOnboarding =
      s0 === "(protected)" && (s2 === "onboarding" || s1 === "onboarding");

    // ✅ Hide footer on Settings
    const isSettings = s0 === "(protected)" && s1 === "settings";

    const isWelcome = s0 === "(protected)" && s1 === "welcome";

    // ✅ Hide footer on specific Nutrition screens
    const isNutrition = s0 === "(protected)" && s1 === "nutrition";

    // Screens you want FULLSCREEN (no footer)
    const fullscreenNutritionScreens = new Set([
      "today",
      "weight",
      "goal",
      "streaks",
      "week",
      "add",
      "food-quality",
      "barcode",
      "nutrition-list",
      "fuelmatch",
      // dynamic meal detail route folder: /nutrition/[mealId]
      "[mealId]",
    ]);

    const isFullscreenNutrition =
      isNutrition && fullscreenNutritionScreens.has(String(s2 || ""));

    // ✅ Hide footer on ALL train session pages:
    // /(protected)/train/session/[sessionKey]/*
    const isTrainSession =
      s0 === "(protected)" && s1 === "train" && s2 === "session";
    const isTrainCoachPlans =
      s0 === "(protected)" && s1 === "train" && s2 === "coach-plans";
    const isTrainViewPlan =
      s0 === "(protected)" && s1 === "train" && s2 === "view-plan";
    const isTrainHistoryDetail =
      s0 === "(protected)" &&
      s1 === "train" &&
      s2 === "history" &&
      !!segments?.[3];
    const isMeActivityDetail =
      s0 === "(protected)" && s1 === "me" && s2 === "activity";
    const isHistoryActivityDetail =
      s0 === "(protected)" && s1 === "history" && !!s2;
    const isCameraScreen = s0 === "(protected)" && s1 === "camera";
    const isHomeCalendar =
      s0 === "(protected)" && s1 === "home" && s2 === "calendar";
    const isProfileRoute = s0 === "(protected)" && s1 === "profile";

    return (
      isTrainOnboarding ||
      isAnyOnboarding ||
      isFullscreenNutrition ||
      isSettings ||
      isWelcome ||
      isTrainSession ||
      isTrainCoachPlans ||
      isTrainViewPlan ||
      isTrainHistoryDetail ||
      isMeActivityDetail ||
      isHistoryActivityDetail ||
      isCameraScreen ||
      isProfileRoute ||
      isHomeCalendar ||
      isTrainCreateFlow
    );
  }, [segments, isTrainCreateFlow]);

  if (!nav?.key) return null;

  if (loading || welcomeLoading) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "black",
        }}
      >
        <ActivityIndicator />
        <Text style={{ color: "white", marginTop: 8, opacity: 0.7 }}>
          {deadman ? "Still waking things up…" : "initialising…"}
        </Text>
      </SafeAreaView>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  if (needsWelcome && !isWelcomeRoute) {
    return <Redirect href="/(protected)/welcome" />;
  }

  if (!needsWelcome && isWelcomeRoute) {
    return <Redirect href="/(protected)/home" />;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: isTrainCreateFlow ? colors.bg : "black",
      }}
    >
      <View style={{ flex: 1, backgroundColor: isTrainCreateFlow ? colors.bg : "transparent" }}>
        <Slot />
      </View>

      <LinearGradient
        colors={["rgba(0,0,0,1)", "rgba(0,0,0,0)"]}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 0,
          zIndex: 30,
        }}
        pointerEvents="none"
      />

      {!hideFooter && (
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "transparent",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
        >
          <Footer />
        </View>
      )}
    </View>
  );
}
