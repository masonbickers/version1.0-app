// app/(protected)/profile/[uid].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
;
export default function ProfilePage() {
  const { uid } = useLocalSearchParams();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#007AFF";
  const s = useMemo(() => makeStyles(colors, isDark, accent), [colors, isDark, accent]);

  const [p, setP] = useState(null);
  const [acts, setActs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    let mounted = true;

    (async () => {
      try {
        setLoading(true);

        // profile doc
        const ps = await getDoc(doc(db, "public_profiles", String(uid)));
        if (!mounted) return;
        setP(ps.exists() ? { uid: ps.id, ...ps.data() } : null);

        // recent activities for this user (needs composite index: uid ASC, createdAt DESC)
        const qActs = query(
          collection(db, "activities"),
          where("uid", "==", String(uid)),
          orderBy("createdAt", "desc"),
          limit(20)
        );
        const snap = await getDocs(qActs);
        if (!mounted) return;
        setActs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.warn("Failed to load profile/activities", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [uid]);

  // Derived counts
  const sessionCount = useMemo(
    () => acts.filter((a) => a.type === "activity").length || acts.length,
    [acts]
  );
  const postCount = useMemo(
    () => acts.filter((a) => a.type === "post").length,
    [acts]
  );

  const displayName = p?.name || "Athlete";
  const username = p?.username || (p?.handle || null);

  const renderActivity = ({ item }) => {
    const isRun =
      item.type === "activity" ||
      /run/i.test(item.title || "") ||
      /km/.test(item.meta || "");
    const iconName = isRun ? "activity" : "zap";

    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/activity/${item.id}`)}
      >
        <View style={s.cardRow}>
          <View style={s.cardIconWrap}>
            <Feather name={iconName} size={18} color={colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>{item.title || "Session"}</Text>
            {!!item.meta && (
              <Text style={s.cardMeta} numberOfLines={1}>
                {item.meta}
              </Text>
            )}
            {!!item.when && <Text style={s.cardWhen}>{item.when}</Text>}
          </View>
          <Feather name="chevron-right" size={18} color={colors.subtext} />
        </View>
      </TouchableOpacity>
    );
  };

  const ListHeader = () => (
    <View style={s.headerBlock}>
      {/* Top row: back + overflow */}
      <View style={s.headerTopRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          activeOpacity={0.8}
        >
          <Feather name="chevron-left" size={18} color={accent} />
          <Text style={s.backText}>Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {}}
          style={s.moreBtn}
          activeOpacity={0.7}
        >
          <Feather name="more-horizontal" size={20} color={colors.subtext} />
        </TouchableOpacity>
      </View>

      {/* Name / username header */}
      <View style={s.headerTitleWrap}>
        <Text style={s.headerTitle}>{displayName}</Text>
        {!!username && (
          <Text style={s.headerSubtitle}>@{username}</Text>
        )}
      </View>

      {/* Profile card */}
      <View style={s.profileCard}>
        <View style={s.profileRow}>
          <Image
            source={{
              uri: p?.photoURL || "https://i.pravatar.cc/120?img=7",
            }}
            style={s.avatar}
          />

          <View style={s.profileStatsCol}>
            <View style={s.statsRow}>
              <View style={s.statBox}>
                <Text style={s.statValue}>{sessionCount}</Text>
                <Text style={s.statLabel}>
                  {sessionCount === 1 ? "Session" : "Sessions"}
                </Text>
              </View>
              <View style={s.statBox}>
                <Text style={s.statValue}>{postCount}</Text>
                <Text style={s.statLabel}>
                  {postCount === 1 ? "Post" : "Posts"}
                </Text>
              </View>
            </View>

            {!!p?.sport && (
              <View style={s.chipRow}>
                <View style={s.sportChip}>
                  <Feather
                    name="activity"
                    size={14}
                    color="#FFFFFF"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={s.sportChipText}>{p.sport}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Bio / extra info */}
        {!!p?.bio && (
          <Text style={s.bio} numberOfLines={3}>
            {p.bio}
          </Text>
        )}

        {(p?.location || p?.website) && (
          <View style={s.metaRow}>
            {!!p?.location && (
              <View style={s.metaItem}>
                <Feather name="map-pin" size={14} color={colors.subtext} />
                <Text style={s.metaText}>{p.location}</Text>
              </View>
            )}
            {!!p?.website && (
              <View style={s.metaItem}>
                <Feather name="link" size={14} color={colors.subtext} />
                <Text style={s.metaText} numberOfLines={1}>
                  {p.website}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* CTA row (pure UI for now) */}
        <View style={s.ctaRow}>
          <TouchableOpacity style={s.primaryBtn} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>Follow</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} activeOpacity={0.85}>
            <Feather
              name="send"
              size={16}
              color={colors.text}
              style={{ marginRight: 6 }}
            />
            <Text style={s.secondaryBtnText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Section header */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Recent activity</Text>
        <Text style={s.sectionSubtitle}>
          Latest sessions and posts from this athlete.
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={accent} />
          <Text style={s.loadingText}>Loading profile…</Text>
        </View>
      ) : (
        <FlatList
          data={acts}
          keyExtractor={(a) => a.id}
          renderItem={renderActivity}
          contentContainerStyle={s.listContent}
          ListHeaderComponent={<ListHeader />}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListEmptyComponent={
            <View style={s.emptyState}>
              <Text style={s.emptyTitle}>No activity yet</Text>
              <Text style={s.emptySubtitle}>
                When this athlete logs sessions or posts, they’ll appear here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c, isDark, accent) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: c.bg,
    },

    /* HEADER BLOCK */
    headerBlock: {
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 8,
    },
    headerTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 4,
      paddingRight: 8,
    },
    backText: {
      color: accent,
      fontSize: 15,
      fontWeight: "600",
      marginLeft: 2,
    },
    moreBtn: {
      padding: 4,
    },
    headerTitleWrap: {
      marginBottom: 12,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: "800",
      color: c.headerTitle || c.text,
    },
    headerSubtitle: {
      marginTop: 2,
      fontSize: 13,
      color: c.headerSubtitle || c.subtext,
    },

    /* PROFILE CARD */
    profileCard: {
      borderRadius: 18,
      padding: 14,
      backgroundColor: c.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      marginBottom: 16,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: isDark ? 0.25 : 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: isDark ? 0 : 2 },
      }),
    },
    profileRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
      gap: 12,
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.muted,
    },
    profileStatsCol: {
      flex: 1,
      gap: 8,
    },
    statsRow: {
      flexDirection: "row",
      gap: 10,
    },
    statBox: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: c.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    statValue: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
    },
    statLabel: {
      fontSize: 12,
      color: c.subtext,
      marginTop: 2,
    },

    chipRow: {
      flexDirection: "row",
      gap: 6,
      marginTop: 2,
    },
    sportChip: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: accent,
    },
    sportChipText: {
      fontSize: 12,
      color: "#FFFFFF",
      fontWeight: "600",
    },

    bio: {
      marginTop: 6,
      fontSize: 13,
      color: c.subtext,
      lineHeight: 18,
    },

    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 8,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    metaText: {
      fontSize: 12,
      color: c.subtext,
      maxWidth: 180,
    },

    ctaRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 12,
    },
    primaryBtn: {
      flex: 1,
      backgroundColor: accent,
      borderRadius: 999,
      paddingVertical: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnText: {
      color: "#FFFFFF",
      fontWeight: "700",
      fontSize: 14,
    },
    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    secondaryBtnText: {
      color: c.text,
      fontWeight: "600",
      fontSize: 14,
    },

    /* SECTION HEADER */
    sectionHeader: {
      marginTop: 4,
      marginBottom: 4,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: c.text,
    },
    sectionSubtitle: {
      fontSize: 13,
      color: c.subtext,
      marginTop: 2,
    },

    /* LIST / CARDS */
    listContent: {
      paddingBottom: 100,
    },
    sep: {
      height: 8,
    },
    card: {
      marginHorizontal: 18,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    cardRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    cardIconWrap: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: c.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: c.text,
    },
    cardMeta: {
      marginTop: 2,
      fontSize: 12,
      color: c.subtext,
    },
    cardWhen: {
      marginTop: 2,
      fontSize: 11,
      color: c.subtext,
    },

    /* EMPTY + LOADING */
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      marginTop: 8,
      fontSize: 12,
      color: c.subtext,
    },
    emptyState: {
      alignItems: "center",
      marginTop: 40,
      paddingHorizontal: 24,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: c.text,
      marginBottom: 4,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: 13,
      color: c.subtext,
      textAlign: "center",
    },
  });
}
