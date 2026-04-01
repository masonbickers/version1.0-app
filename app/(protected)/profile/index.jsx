// app/(protected)/profile/index.jsx
"use client";

import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const AVATAR_FOLDER = "avatars";

export default function EditProfilePage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const accent = colors.sapPrimary || colors.primary || "#007AFF";
  const s = useMemo(() => makeStyles(colors, isDark, accent), [colors, isDark, accent]);
  const storage = getStorage();

  const user = auth.currentUser;

  const [loading, setLoading] = useState(true);

  // Profile fields
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [sport, setSport] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");

  // Avatar
  const [photoURL, setPhotoURL] = useState("");
  const [localAvatarUri, setLocalAvatarUri] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Account fields
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [updatingAccount, setUpdatingAccount] = useState(false);

  // Data overview
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [garmin, setGarmin] = useState(null);
  const [counts, setCounts] = useState({
    nutrition: 0,
    training: 0,
    activity: 0,
    garminActivities: 0,
  });
  const [recent, setRecent] = useState({
    nutritionLastAt: null,
    trainingLastAt: null,
    activityLastAt: null,
  });

  useEffect(() => {
    const load = async () => {
      try {
        if (!user) {
          setLoading(false);
          setLoadingOverview(false);
          return;
        }

        // Base auth info
        setName(user.displayName || "");
        setEmail(user.email || "");
        setNewEmail(user.email || "");
        setPhotoURL(user.photoURL || "");

        // Public profile doc
        const profileRef = doc(db, "public_profiles", user.uid);
        const snap = await getDoc(profileRef);
        if (snap.exists()) {
          const d = snap.data();
          setUsername(d.username || d.handle || "");
          setBio(d.bio || "");
          setSport(d.sport || "");
          setLocation(d.location || "");
          setWebsite(d.website || "");
          if (d.photoURL && !user.photoURL) {
            setPhotoURL(d.photoURL);
          }
        }

        // Data overview (users doc + counts)
        await loadOverview(user.uid);
      } catch (e) {
        console.log("[profile/edit] load error", e);
        Alert.alert("Error", "Could not load your profile. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadOverview = async (uid) => {
    setLoadingOverview(true);
    try {
      // 1) users/{uid} -> integrations.garmin
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      setGarmin(userData?.integrations?.garmin || null);

      // 2) Counts (best-effort, change names to match your schema)
      const c = await loadCounts(uid);
      setCounts(c);

      // 3) Recent timestamps (best-effort)
      const r = await loadRecents(uid);
      setRecent(r);
    } catch (e) {
      console.log("[profile/edit] overview error", e);
    } finally {
      setLoadingOverview(false);
    }
  };

  const loadCounts = async (uid) => {
    const tryCount = async (pathParts, qOpts) => {
      try {
        const colRef = collection(db, ...pathParts);
        const q = qOpts ? qOpts(colRef) : colRef;
        const snap = await getDocs(q);
        return snap.size || 0;
      } catch {
        return 0;
      }
    };

    // Change these to your actual subcollections if different:
    const nutrition = await tryCount(["users", uid, "nutrition_logs"], (colRef) =>
      // Limit to reduce reads (not exact if you have >200, but good overview)
      // If you want exact counts later, use an aggregate count endpoint.
      // For now, keep it simple.
      // Note: Firestore doesn't support count aggregation without new APIs; this is a lightweight approximation.
      // We'll cap at 200.
      // eslint-disable-next-line no-undef
      query(colRef, limit(200))
    );

    const training = await tryCount(["users", uid, "workoutTemplates"], (colRef) =>
      // eslint-disable-next-line no-undef
      query(colRef, limit(200))
    );

    const activity = await tryCount(["users", uid, "activities"], (colRef) =>
      // eslint-disable-next-line no-undef
      query(colRef, limit(200))
    );

    // Garmin activities (try common names)
    const garmin_activities = await tryCount(["users", uid, "garmin_activities"], (colRef) =>
      // eslint-disable-next-line no-undef
      query(colRef, limit(200))
    );
    const garminActivities =
      garmin_activities ||
      (await tryCount(["users", uid, "garminActivities"], (colRef) =>
        // eslint-disable-next-line no-undef
        query(colRef, limit(200))
      ));

    return { nutrition, training, activity, garminActivities };
  };

  const loadRecents = async (uid) => {
    const tryLatest = async (pathParts, field = "createdAt") => {
      try {
        const colRef = collection(db, ...pathParts);
        const q = query(colRef, orderBy(field, "desc"), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) return null;
        const d = snap.docs[0].data();
        const v = d?.[field];
        // Firestore Timestamp support
        if (v?.toDate) return v.toDate().getTime();
        if (typeof v === "number") return v;
        return null;
      } catch {
        return null;
      }
    };

    const nutritionLastAt = await tryLatest(["users", uid, "nutrition_logs"], "createdAt");
    const trainingLastAt = await tryLatest(["users", uid, "workoutTemplates"], "updatedAt");
    const activityLastAt = await tryLatest(["users", uid, "activities"], "startTimeMs");

    return { nutritionLastAt, trainingLastAt, activityLastAt };
  };

  const formatWhen = (ms) => {
    if (!ms) return "—";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  };

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return Alert.alert(
        "Permission needed",
        "Allow photo access to change your profile picture."
      );
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!res.canceled && res.assets?.[0]?.uri) {
      setLocalAvatarUri(res.assets[0].uri);
    }
  };

  const uploadAvatarIfNeeded = async () => {
    if (!localAvatarUri || !user) return photoURL || null;

    const blob = await (await fetch(localAvatarUri)).blob();
    const key = `${AVATAR_FOLDER}/${user.uid}.jpg`;
    const r = ref(storage, key);
    await uploadBytes(r, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(r);
    setPhotoURL(url);
    return url;
  };

  const handleSaveProfile = async () => {
    if (!user) {
      return Alert.alert(
        "Not signed in",
        "You need to be signed in to edit your profile."
      );
    }

    try {
      setSavingProfile(true);

      const finalPhotoURL = await uploadAvatarIfNeeded();

      // Update Firebase Auth profile
      await updateProfile(user, {
        displayName: name || user.displayName || "",
        photoURL: finalPhotoURL || user.photoURL || "",
      });

      // Update public profile doc
      const profileRef = doc(db, "public_profiles", user.uid);
      await setDoc(
        profileRef,
        {
          uid: user.uid,
          name: name || user.displayName || "",
          username: (username || "").trim(),
          bio: bio || "",
          sport: sport || "",
          location: location || "",
          website: website || "",
          photoURL: finalPhotoURL || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      Alert.alert("Saved", "Your profile has been updated.");
      await loadOverview(user.uid);
    } catch (e) {
      console.log("[profile/edit] save error", e);
      Alert.alert("Update failed", e?.message || "Could not save your profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdateAccount = async () => {
    if (!user) {
      return Alert.alert(
        "Not signed in",
        "You need to be signed in to change account settings."
      );
    }

    const wantsEmailChange = newEmail && newEmail.trim() !== (user.email || "");
    const wantsPasswordChange = !!newPassword;

    if (!wantsEmailChange && !wantsPasswordChange) {
      return Alert.alert(
        "Nothing to update",
        "Change your email or password, then tap Update account."
      );
    }

    if (!currentPassword) {
      return Alert.alert(
        "Current password required",
        "Enter your current password to update email or password."
      );
    }

    try {
      setUpdatingAccount(true);

      // Re-authenticate
      const cred = EmailAuthProvider.credential(
        user.email || "",
        currentPassword
      );
      await reauthenticateWithCredential(user, cred);

      if (wantsEmailChange) {
        await updateEmail(user, newEmail.trim());
        setEmail(newEmail.trim());
      }

      if (wantsPasswordChange) {
        await updatePassword(user, newPassword);
        setNewPassword("");
        setCurrentPassword("");
      }

      Alert.alert("Account updated", "Your account details were updated.");
    } catch (e) {
      console.log("[profile/edit] account update error", e);
      Alert.alert(
        "Update failed",
        e?.message ||
          "Could not update your account. Check your password and try again."
      );
    } finally {
      setUpdatingAccount(false);
    }
  };

  const avatarSrc =
    localAvatarUri || photoURL || "https://i.pravatar.cc/200?img=5";

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.center}>
          <ActivityIndicator color={accent} />
          <Text style={s.loadingText}>Loading profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const garminConnected = garmin?.connected === true;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}
          <View style={s.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={s.backBtn}
              activeOpacity={0.8}
            >
              <Feather name="chevron-left" size={18} color={accent} />
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Profile</Text>
              <Text style={s.headerSubtitle}>
                Your info & your data
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => loadOverview(user?.uid)}
              style={s.iconBtn}
              activeOpacity={0.85}
              disabled={!user || loadingOverview}
            >
              {loadingOverview ? (
                <ActivityIndicator color={accent} />
              ) : (
                <Feather name="refresh-cw" size={16} color={accent} />
              )}
            </TouchableOpacity>
          </View>

          {/* DATA OVERVIEW */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Your Data</Text>

            {!user ? (
              <Text style={s.helper}>Sign in to view your data overview.</Text>
            ) : (
              <>
                <View style={s.grid2}>
                  {/* Garmin */}
                  <View style={s.dataCard}>
                    <View style={s.dataCardTop}>
                      <Feather name="watch" size={16} color={accent} />
                      <Text style={s.dataCardTitle}>Garmin</Text>
                      <View style={{ flex: 1 }} />
                      <View
                        style={[
                          s.pill,
                          garminConnected ? s.pillOk : s.pillWarn,
                        ]}
                      >
                        <Text
                          style={[
                            s.pillText,
                            garminConnected ? s.pillTextOk : s.pillTextWarn,
                          ]}
                        >
                          {garminConnected ? "Connected" : "Not linked"}
                        </Text>
                      </View>
                    </View>

                    <Text style={s.dataCardMeta}>
                      User ID:{" "}
                      <Text style={s.dataCardMetaStrong}>
                        {garmin?.garminUserId || "—"}
                      </Text>
                    </Text>

                    <Text style={s.dataCardMeta}>
                      Linked:{" "}
                      <Text style={s.dataCardMetaStrong}>
                        {garmin?.linkedAtMs ? formatWhen(garmin.linkedAtMs) : "—"}
                      </Text>
                    </Text>

                    <Text style={s.dataCardMeta}>
                      Imported:{" "}
                      <Text style={s.dataCardMetaStrong}>
                        {counts.garminActivities}
                      </Text>
                    </Text>

                    <Pressable
                      onPress={() => router.push("/profile/garmin-data")}
                      style={({ pressed }) => [
                        s.smallBtn,
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Feather name="external-link" size={14} color={colors.text} />
                      <Text style={s.smallBtnText}>View Garmin data</Text>
                    </Pressable>
                  </View>

                  {/* Nutrition */}
                  <View style={s.dataCard}>
                    <View style={s.dataCardTop}>
                      <Feather name="coffee" size={16} color={accent} />
                      <Text style={s.dataCardTitle}>Nutrition</Text>
                    </View>
                    <Text style={s.dataCardMeta}>
                      Logs:{" "}
                      <Text style={s.dataCardMetaStrong}>{counts.nutrition}</Text>
                    </Text>
                    <Text style={s.dataCardMeta}>
                      Last:{" "}
                      <Text style={s.dataCardMetaStrong}>
                        {formatWhen(recent.nutritionLastAt)}
                      </Text>
                    </Text>
                    <Pressable
                      onPress={() => router.push("/nutrition")}
                      style={({ pressed }) => [
                        s.smallBtn,
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Feather name="arrow-right" size={14} color={colors.text} />
                      <Text style={s.smallBtnText}>Open Nutrition</Text>
                    </Pressable>
                  </View>

                  {/* Training */}
                  <View style={s.dataCard}>
                    <View style={s.dataCardTop}>
                      <Feather name="activity" size={16} color={accent} />
                      <Text style={s.dataCardTitle}>Training</Text>
                    </View>
                    <Text style={s.dataCardMeta}>
                      Templates:{" "}
                      <Text style={s.dataCardMetaStrong}>{counts.training}</Text>
                    </Text>
                    <Text style={s.dataCardMeta}>
                      Last:{" "}
                      <Text style={s.dataCardMetaStrong}>
                        {formatWhen(recent.trainingLastAt)}
                      </Text>
                    </Text>
                    <Pressable
                      onPress={() => router.push("profile/garmin-health")}
                      style={({ pressed }) => [
                        s.smallBtn,
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Feather name="arrow-right" size={14} color={colors.text} />
                      <Text style={s.smallBtnText}>Open Workouts</Text>
                    </Pressable>
                  </View>

                  {/* Activity */}
                  <View style={s.dataCard}>
                    <View style={s.dataCardTop}>
                      <Feather name="trending-up" size={16} color={accent} />
                      <Text style={s.dataCardTitle}>Activity</Text>
                    </View>
                    <Text style={s.dataCardMeta}>
                      Sessions:{" "}
                      <Text style={s.dataCardMetaStrong}>{counts.activity}</Text>
                    </Text>
                    <Text style={s.dataCardMeta}>
                      Last:{" "}
                      <Text style={s.dataCardMetaStrong}>
                        {formatWhen(recent.activityLastAt)}
                      </Text>
                    </Text>
                    <Pressable
                      onPress={() => router.push("/me")}
                      style={({ pressed }) => [
                        s.smallBtn,
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Feather name="arrow-right" size={14} color={colors.text} />
                      <Text style={s.smallBtnText}>Open Me</Text>
                    </Pressable>
                  </View>
                </View>

                <Text style={[s.helper, { marginTop: 10 }]}>
                  If any counts show 0, it just means the collection name in this page
                  doesn’t match your Firestore yet — tell me your exact paths and I’ll align it.
                </Text>
              </>
            )}
          </View>

          {/* PROFILE SECTION */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Edit Profile</Text>

            {/* Avatar */}
            <View style={s.avatarRow}>
              <Image source={{ uri: avatarSrc }} style={s.avatar} />
              <View style={{ flex: 1 }}>
                <Text style={s.avatarLabel}>Profile picture</Text>
                <Text style={s.avatarHint}>
                  This is how you’ll appear to other athletes.
                </Text>
                <TouchableOpacity
                  style={s.avatarBtn}
                  onPress={handlePickAvatar}
                  activeOpacity={0.85}
                >
                  <Feather name="image" size={16} color={colors.text} />
                  <Text style={s.avatarBtnText}>Change photo</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Name / username / bio */}
            <View style={s.inputGroup}>
              <Text style={s.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.subtextSoft}
                style={s.input}
              />
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Username</Text>
              <TextInput
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                placeholder="username"
                placeholderTextColor={colors.subtextSoft}
                style={s.input}
              />
              <Text style={s.helper}>
                This may be visible in leaderboards and social views.
              </Text>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Bio</Text>
              <TextInput
                value={bio}
                onChangeText={setBio}
                placeholder="Tell people a bit about you…"
                placeholderTextColor={colors.subtextSoft}
                style={[s.input, s.multiline]}
                multiline
              />
            </View>

            <View style={s.row2}>
              <View style={[s.inputGroup, { flex: 1 }]}>
                <Text style={s.label}>Primary sport</Text>
                <TextInput
                  value={sport}
                  onChangeText={setSport}
                  placeholder="e.g. Running, Hyrox"
                  placeholderTextColor={colors.subtextSoft}
                  style={s.input}
                />
              </View>
              <View style={[s.inputGroup, { flex: 1 }]}>
                <Text style={s.label}>Location</Text>
                <TextInput
                  value={location}
                  onChangeText={setLocation}
                  placeholder="e.g. London, UK"
                  placeholderTextColor={colors.subtextSoft}
                  style={s.input}
                />
              </View>
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>Website</Text>
              <TextInput
                value={website}
                onChangeText={setWebsite}
                autoCapitalize="none"
                placeholder="https://"
                placeholderTextColor={colors.subtextSoft}
                style={s.input}
              />
            </View>

            <Pressable
              onPress={handleSaveProfile}
              style={({ pressed }) => [
                s.primaryBtn,
                pressed && { opacity: 0.92 },
              ]}
              disabled={savingProfile}
            >
              {savingProfile ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="save" size={16} color="#fff" />
                  <Text style={s.primaryBtnText}>Save profile</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* ACCOUNT SECTION */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Account</Text>

            <View style={s.inputGroup}>
              <Text style={s.label}>Current email</Text>
              <TextInput
                value={email}
                editable={false}
                style={[s.input, s.inputDisabled]}
              />
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>New email</Text>
              <TextInput
                value={newEmail}
                onChangeText={setNewEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Enter new email"
                placeholderTextColor={colors.subtextSoft}
                style={s.input}
              />
            </View>

            <View style={s.inputGroup}>
              <Text style={s.label}>New password</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Leave blank to keep current"
                placeholderTextColor={colors.subtextSoft}
                style={s.input}
                secureTextEntry
              />
            </View>

            {(newPassword || newEmail !== email) && (
              <View style={s.inputGroup}>
                <Text style={s.label}>Current password</Text>
                <TextInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Required to update email/password"
                  placeholderTextColor={colors.subtextSoft}
                  style={s.input}
                  secureTextEntry
                />
              </View>
            )}

            <Pressable
              onPress={handleUpdateAccount}
              style={({ pressed }) => [
                s.secondaryBtn,
                pressed && { opacity: 0.95 },
              ]}
              disabled={updatingAccount}
            >
              {updatingAccount ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <>
                  <Feather name="lock" size={16} color={colors.text} />
                  <Text style={s.secondaryBtnText}>Update account</Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------- styles ---------- */

function makeStyles(colors, isDark, accent) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    content: {
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 80,
      gap: 22,
    },

    /* HEADER */
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      paddingRight: 10,
      paddingVertical: 4,
      marginRight: 4,
    },
    backText: {
      color: accent,
      fontSize: 15,
      fontWeight: "600",
      marginLeft: 2,
    },
    headerTitle: {
      fontSize: 30,
      fontWeight: "800",
      color: colors.headerTitle || colors.text,
    },
    headerSubtitle: {
      fontSize: 14,
      color: colors.headerSubtitle || colors.subtext,
      marginTop: 2,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },

    /* SECTIONS */
    section: {
      borderRadius: 16,
      padding: 14,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: colors.text,
      marginBottom: 10,
    },

    /* DATA GRID */
    grid2: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    dataCard: {
      width: "48%",
      borderRadius: 14,
      padding: 12,
      backgroundColor: colors.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 6,
    },
    dataCardTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 2,
    },
    dataCardTitle: {
      fontSize: 13,
      fontWeight: "900",
      color: colors.text,
    },
    dataCardMeta: {
      fontSize: 12,
      color: colors.subtext,
    },
    dataCardMetaStrong: {
      color: colors.text,
      fontWeight: "800",
    },

    pill: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
    },
    pillOk: {
      backgroundColor: isDark ? "rgba(16,185,129,0.16)" : "rgba(16,185,129,0.12)",
      borderColor: isDark ? "rgba(16,185,129,0.35)" : "rgba(16,185,129,0.25)",
    },
    pillWarn: {
      backgroundColor: isDark ? "rgba(245,158,11,0.16)" : "rgba(245,158,11,0.12)",
      borderColor: isDark ? "rgba(245,158,11,0.35)" : "rgba(245,158,11,0.25)",
    },
    pillText: {
      fontSize: 11,
      fontWeight: "900",
    },
    pillTextOk: { color: isDark ? "#a7f3d0" : "#065f46" },
    pillTextWarn: { color: isDark ? "#fde68a" : "#92400e" },

    smallBtn: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 9,
      borderRadius: 999,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    smallBtnText: {
      fontSize: 12,
      fontWeight: "800",
      color: colors.text,
    },

    /* AVATAR */
    avatarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 12,
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.muted,
    },
    avatarLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    avatarHint: {
      fontSize: 12,
      color: colors.subtext,
      marginTop: 2,
      marginBottom: 6,
    },
    avatarBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    avatarBtnText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },

    /* INPUTS */
    inputGroup: {
      marginBottom: 10,
    },
    label: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.subtext,
      marginBottom: 4,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    input: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.bg,
    },
    multiline: {
      minHeight: 80,
      textAlignVertical: "top",
    },
    helper: {
      fontSize: 11,
      color: colors.subtext,
      marginTop: 4,
    },
    row2: {
      flexDirection: "row",
      gap: 10,
    },
    inputDisabled: {
      backgroundColor: isDark ? "#2C2C2E" : "#E5E5EA",
      color: colors.subtext,
    },

    /* BUTTONS */
    primaryBtn: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 999,
      paddingVertical: 12,
      backgroundColor: accent,
    },
    primaryBtnText: {
      color: "#FFFFFF",
      fontWeight: "800",
      fontSize: 14,
    },

    secondaryBtn: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 999,
      paddingVertical: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    secondaryBtnText: {
      color: colors.text,
      fontWeight: "700",
      fontSize: 14,
    },

    /* EMPTY / LOADING */
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      marginTop: 6,
      fontSize: 12,
      color: colors.subtext,
    },
  });
}
