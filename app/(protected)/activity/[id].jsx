// app/(protected)/activity/[id].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";
;
/* ───────── utils ───────── */
const relTime = (ts) => {
  if (!ts) return "";
  const t = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 172800) return "yesterday";
  return t.toLocaleDateString();
};

export default function ActivityDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme(); // { bg, card, text, subtext, border, muted, primary, ... }
  const s = useMemo(() => makeStyles(colors), [colors]);

  const me = auth.currentUser;

  const [a, setA] = useState(null);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // activity doc
      const snap = await getDoc(doc(db, "activities", String(id)));
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      if (!alive) return;
      setA(data);

      // like status for this user
      if (me?.uid && data) {
        const likeSnap = await getDoc(
          doc(db, "activities", data.id, "likes", me.uid)
        );
        if (!alive) return;
        setLiked(likeSnap.exists());
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const toggleLike = async () => {
    if (!me?.uid || !a) return;

    // optimistic UI
    setLiked((v) => !v);
    setA((prev) =>
      prev ? { ...prev, likeCount: Math.max(0, (prev.likeCount || 0) + (liked ? -1 : 1)) } : prev
    );

    // write
    const likeRef = doc(db, "activities", a.id, "likes", me.uid);
    const actRef = doc(db, "activities", a.id);
    const batch = writeBatch(db);
    if (liked) {
      batch.delete(likeRef);
      batch.set(actRef, { likeCount: (a.likeCount || 0) - 1 }, { merge: true });
    } else {
      batch.set(likeRef, { createdAt: serverTimestamp() });
      batch.set(actRef, { likeCount: (a.likeCount || 0) + 1 }, { merge: true });
    }
    try {
      await batch.commit();
    } catch {
      // revert if failed
      setLiked((v) => !v);
      setA((prev) =>
        prev ? { ...prev, likeCount: Math.max(0, (prev.likeCount || 0) + (liked ? 1 : -1)) } : prev
      );
    }
  };

  const shareIt = async () => {
    if (!a) return;
    try {
      await Share.share({
        title: a.title || "Activity",
        message: `${a.userName || "Athlete"}: ${a.title || "Activity"} — ${a.meta || ""}`,
      });
    } catch {}
  };

  if (!a) {
    return <SafeAreaView style={s.safe} />;
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>{a.title}</Text>

        {!!a.thumbnail && (
          <Image source={{ uri: a.thumbnail }} style={[s.img, { backgroundColor: colors.muted }]} />
        )}

        {!!a.meta && <Text style={s.meta}>{a.meta}</Text>}

        <View style={s.postRow}>
          <Text style={s.postBy}>
            Posted by <Text style={s.bold}>{a.userName || "Athlete"}</Text>
          </Text>
          <Text style={s.time}>{relTime(a.createdAt)}</Text>
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity style={s.action} onPress={toggleLike}>
            <Feather
              name="heart"
              size={18}
              color={liked ? colors.primary : colors.subtext}
            />
            <Text style={s.actionText}>{a.likeCount || 0}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.action}
            onPress={() => router.push(`/activity/${a.id}`)} // keep here if you later add threaded comments
          >
            <Feather name="message-circle" size={18} color={colors.subtext} />
            <Text style={s.actionMuted}>Comment</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.action} onPress={shareIt}>
            <Feather name="share-2" size={18} color={colors.subtext} />
            <Text style={s.actionMuted}>Share</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ───────── styles ───────── */
const makeStyles = (c) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 100 },
    title: { fontSize: 22, fontWeight: "800", color: c.text, marginBottom: 8 },
    img: { width: "100%", height: 220, borderRadius: 12 },
    meta: { marginTop: 6, color: c.subtext },
    postRow: {
      marginTop: 10,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    postBy: { color: c.text },
    bold: { fontWeight: "800", color: c.text },
    time: { color: c.subtext, fontSize: 12 },

    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginTop: 14,
    },
    action: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
    actionText: { color: c.text, fontWeight: "700" },
    actionMuted: { color: c.subtext },
  });
