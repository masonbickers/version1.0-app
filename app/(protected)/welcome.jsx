import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const SLIDES = [
  {
    id: "welcome",
    title: "Welcome to version1.0",
    body: "Swipe through this quick intro to see where everything lives.",
    points: [
      "Home shows your day and your week at a glance.",
      "Train is where you build and edit plans.",
      "Fuel and Chat keep execution simple every day.",
    ],
  },
  {
    id: "train",
    title: "Build your plan",
    body: "Use Train to create a running plan based on your goal and schedule.",
    points: [
      "Pick distance, target date, and weekly run days.",
      "Generate a plan that adapts to your current fitness.",
      "Adjust sessions if your week changes.",
    ],
  },
  {
    id: "track",
    title: "Track execution",
    body: "Log sessions and monitor progress so your next block is smarter.",
    points: [
      "Use Summary and Me for consistency and trends.",
      "Review history to see what is working.",
      "Keep easy days easy and quality days focused.",
    ],
  },
  {
    id: "fuel-chat",
    title: "Fuel + AI coach",
    body: "Use Fuel for nutrition support and Chat when you need fast guidance.",
    points: [
      "Plan meals around training demand.",
      "Ask the coach for session or recovery advice.",
      "Use this daily to stay consistent.",
    ],
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const carouselWidth = Math.max(280, width - 40);
  const listRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const isLast = index === SLIDES.length - 1;

  const finishWelcome = useCallback(async () => {
    try {
      setSaving(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("No authenticated user found.");

      await setDoc(
        doc(db, "users", uid),
        {
          welcomeSeen: true,
          welcomeSeenAt: serverTimestamp(),
        },
        { merge: true }
      );

      router.replace("/(protected)/home");
    } catch (e) {
      Alert.alert("Could not continue", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [router]);

  const goTo = useCallback(
    (nextIdx) => {
      const clamped = Math.max(0, Math.min(nextIdx, SLIDES.length - 1));
      setIndex(clamped);
      listRef.current?.scrollToIndex?.({ index: clamped, animated: true });
    },
    []
  );

  const onNext = useCallback(() => {
    if (isLast) {
      finishWelcome();
      return;
    }
    goTo(index + 1);
  }, [finishWelcome, goTo, index, isLast]);

  const onBack = useCallback(() => {
    if (index <= 0) return;
    goTo(index - 1);
  }, [goTo, index]);

  const onMomentumEnd = useCallback(
    (e) => {
      const x = e?.nativeEvent?.contentOffset?.x || 0;
      const next = Math.round(x / carouselWidth);
      if (next !== index) setIndex(next);
    },
    [carouselWidth, index]
  );

  const renderSlide = useCallback(
    ({ item }) => (
      <View style={[s.slideWrap, { width: carouselWidth }]}>
        <View style={s.card}>
          <Text style={s.cardTitle}>{item.title}</Text>
          <Text style={s.cardBody}>{item.body}</Text>
          <View style={s.points}>
            {item.points.map((point) => (
              <View key={point} style={s.pointRow}>
                <View style={s.pointDot} />
                <Text style={s.pointText}>{point}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    ),
    [carouselWidth, s.card, s.cardBody, s.cardTitle, s.pointDot, s.pointRow, s.pointText, s.points, s.slideWrap]
  );

  const getItemLayout = useCallback(
    (_data, itemIndex) => ({
      length: carouselWidth,
      offset: carouselWidth * itemIndex,
      index: itemIndex,
    }),
    [carouselWidth]
  );

  const onScrollToIndexFailed = useCallback(
    ({ index: failedIndex }) => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset?.({
          offset: failedIndex * carouselWidth,
          animated: true,
        });
      });
    },
    [carouselWidth]
  );

  const skipIntro = useCallback(() => {
    finishWelcome();
  }, [finishWelcome]);

  const progressLabel = `${index + 1}/${SLIDES.length}`;

  return (
    <SafeAreaView style={s.safe}>
      <LinearGradient
        colors={isDark ? ["#0A0A0A", "#111111", "#000000"] : ["#F7F9EF", "#F5F5F5", "#EFEFEF"]}
        style={s.page}
      >
        <View style={s.topBar}>
          <Text style={s.kicker}>WELCOME</Text>
          <Pressable
            onPress={skipIntro}
            disabled={saving}
            style={({ pressed }) => [s.skipBtn, pressed && !saving && { opacity: 0.8 }]}
          >
            <Text style={s.skipText}>Skip</Text>
          </Pressable>
        </View>

        <View style={s.hero}>
          <Text style={s.title}>Quick tour</Text>
          <Text style={s.subtitle}>
            Learn the core app flow in less than a minute.
          </Text>
        </View>

        <View style={s.carouselArea}>
          <FlatList
            ref={listRef}
            data={SLIDES}
            horizontal
            pagingEnabled
            bounces={false}
            keyExtractor={(item) => item.id}
            renderItem={renderSlide}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            getItemLayout={getItemLayout}
            onScrollToIndexFailed={onScrollToIndexFailed}
            initialNumToRender={SLIDES.length}
          />
        </View>

        <View style={s.footer}>
          <Text style={s.progressText}>{progressLabel}</Text>

          <View style={s.dots}>
            {SLIDES.map((item, dotIndex) => (
              <View
                key={item.id}
                style={[s.dot, dotIndex === index ? s.dotActive : s.dotInactive]}
              />
            ))}
          </View>

          <View style={s.actionsRow}>
            <Pressable
              onPress={onBack}
              disabled={index === 0 || saving}
              style={({ pressed }) => [
                s.backBtn,
                (index === 0 || saving) && s.backBtnDisabled,
                pressed && index > 0 && !saving && { opacity: 0.9 },
              ]}
            >
              <Text style={s.backBtnText}>Back</Text>
            </Pressable>

            <Pressable
              onPress={onNext}
              disabled={saving}
              style={({ pressed }) => [
                s.cta,
                pressed && !saving && { opacity: 0.92 },
                saving && { opacity: 0.7 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#0B0B0B" />
              ) : (
                <Text style={s.ctaText}>
                  {isLast ? "Start using app" : "Next"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

const makeStyles = (colors, isDark) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    page: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 26,
      gap: 12,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    skipBtn: {
      minHeight: 32,
      paddingHorizontal: 12,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong || colors.border,
      backgroundColor: isDark ? "#171717" : colors.card,
    },
    skipText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    hero: {
      gap: 6,
    },
    kicker: {
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 1.2,
      color: colors.accentText || colors.text,
    },
    title: {
      fontSize: 30,
      fontWeight: "900",
      color: colors.text,
    },
    subtitle: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.subtext,
      maxWidth: 360,
    },
    carouselArea: {
      flex: 1,
      minHeight: 0,
    },
    slideWrap: {
      flex: 1,
      justifyContent: "center",
    },
    card: {
      borderRadius: 22,
      padding: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong || colors.border,
      backgroundColor: isDark ? "#121212" : colors.card,
      minHeight: 320,
      justifyContent: "space-between",
    },
    cardTitle: {
      fontSize: 24,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 8,
    },
    cardBody: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.subtext,
      marginBottom: 14,
    },
    points: {
      gap: 10,
    },
    pointRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    pointDot: {
      marginTop: 7,
      width: 8,
      height: 8,
      borderRadius: 8,
      backgroundColor: colors.accentBg || "#E6FF3B",
    },
    pointText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
    footer: {
      gap: 12,
    },
    progressText: {
      textAlign: "center",
      color: colors.subtext,
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.6,
    },
    dots: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 10,
    },
    dotActive: {
      width: 20,
      backgroundColor: colors.accentBg || "#E6FF3B",
    },
    dotInactive: {
      backgroundColor: isDark ? "#3B3B3B" : "#C8CCD1",
    },
    actionsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    backBtn: {
      minHeight: 52,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong || colors.border,
      backgroundColor: isDark ? "#141414" : colors.card,
    },
    backBtnDisabled: {
      opacity: 0.45,
    },
    backBtnText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    cta: {
      flex: 1,
      minHeight: 52,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentBg || "#E6FF3B",
    },
    ctaText: {
      fontSize: 16,
      fontWeight: "800",
      color: "#0B0B0B",
    },
  });
