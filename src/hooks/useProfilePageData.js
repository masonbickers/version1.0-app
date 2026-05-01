import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { auth, db } from "../../firebaseConfig";

const STRAVA_CACHE_KEY = "strava_cached_activities_v1";
const AVATAR_FOLDER = "avatars";
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value?.seconds != null) return Number(value.seconds) * 1000;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatRelativeSync(ms) {
  if (!ms) return "Not synced yet";
  const dayMs = 24 * 60 * 60 * 1000;
  const deltaDays = Math.floor((Date.now() - ms) / dayMs);
  if (deltaDays <= 0) return "Synced today";
  if (deltaDays === 1) return "Synced yesterday";
  return `Synced ${deltaDays} days ago`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeUsername(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "");
}

function normalizeWebsite(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function buildSupportLine(values) {
  const bio = cleanText(values?.bio);
  if (bio) return bio;
  const parts = [cleanText(values?.sport), cleanText(values?.location)].filter(Boolean);
  if (parts.length) return parts.join(" • ");
  return "Edit how you appear in the app";
}

function validateValues(values) {
  const next = {};
  const name = cleanText(values.name);
  const username = normalizeUsername(values.username);
  const bio = cleanText(values.bio);
  const websiteRaw = cleanText(values.website);

  if (!name) {
    next.name = "Name is required.";
  } else if (name.length < 2) {
    next.name = "Name should be at least 2 characters.";
  }

  if (username && !USERNAME_RE.test(username)) {
    next.username = "Use 3-20 lowercase letters, numbers, dots, or underscores.";
  }

  if (bio.length > 160) {
    next.bio = "Bio should stay under 160 characters.";
  }

  if (websiteRaw) {
    try {
      const url = new URL(normalizeWebsite(websiteRaw));
      if (!/^https?:$/i.test(url.protocol)) {
        next.website = "Website must use http or https.";
      }
    } catch {
      next.website = "Enter a valid website URL.";
    }
  }

  return next;
}

function normalizeForSave(values) {
  return {
    name: cleanText(values.name),
    username: normalizeUsername(values.username),
    bio: cleanText(values.bio),
    sport: cleanText(values.sport),
    location: cleanText(values.location),
    website: normalizeWebsite(values.website),
  };
}

function sameValues(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function isUsernameAvailable(uid, username) {
  if (!username) return true;
  const snap = await getDocs(
    query(collection(db, "public_profiles"), where("username", "==", username), limit(2))
  );
  return snap.docs.every((entry) => entry.id === uid);
}

export function useProfilePageData() {
  const user = auth.currentUser;
  const storage = getStorage();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState({
    name: "",
    username: "",
    bio: "",
    sport: "",
    location: "",
    website: "",
    email: "",
    photoURL: "",
  });
  const [initialValues, setInitialValues] = useState(null);
  const [localAvatarUri, setLocalAvatarUri] = useState("");
  const [touched, setTouched] = useState({});
  const [saveState, setSaveState] = useState("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [integrations, setIntegrations] = useState({
    stravaConnected: false,
    garminConnected: false,
    lastStravaSyncMs: 0,
  });

  const load = useCallback(async () => {
    setLoadError("");

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setInitialValues(null);
        setLoading(false);
        return;
      }

      const [userSnap, publicProfileSnap, stravaConnectedRaw, cachedRaw] =
        await Promise.all([
          getDoc(doc(db, "users", uid)),
          getDoc(doc(db, "public_profiles", uid)),
          AsyncStorage.getItem("strava_connected"),
          AsyncStorage.getItem(STRAVA_CACHE_KEY),
        ]);

      let cachedSyncMs = 0;
      if (cachedRaw) {
        try {
          const cached = JSON.parse(cachedRaw);
          cachedSyncMs = toMillis(cached?.cachedAtISO);
        } catch {}
      }

      const userData = userSnap.exists() ? userSnap.data() || {} : {};
      const profileData = publicProfileSnap.exists() ? publicProfileSnap.data() || {} : {};

      const nextValues = {
        name: user?.displayName || profileData?.name || "",
        username: profileData?.username || profileData?.handle || "",
        bio: profileData?.bio || "",
        sport: profileData?.sport || "",
        location: profileData?.location || "",
        website: profileData?.website || "",
        email: user?.email || "",
        photoURL: user?.photoURL || profileData?.photoURL || "",
      };

      setValues(nextValues);
      setInitialValues(normalizeForSave(nextValues));
      setLocalAvatarUri("");
      setTouched({});
      setSaveState("idle");
      setSaveMessage("");

      setIntegrations({
        stravaConnected: stravaConnectedRaw === "1",
        garminConnected: userData?.integrations?.garmin?.connected === true,
        lastStravaSyncMs: toMillis(userData?.lastStravaSyncAt) || cachedSyncMs || 0,
      });
    } catch (error) {
      setLoadError(String(error?.message || error || "Could not load your profile."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.displayName, user?.email, user?.photoURL]);

  useEffect(() => {
    load();
  }, [load]);

  const normalizedValues = useMemo(() => normalizeForSave(values), [values]);
  const errors = useMemo(() => validateValues(values), [values]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty =
    !!initialValues &&
    (!sameValues(initialValues, normalizedValues) || !!localAvatarUri);

  const fieldErrors = useMemo(() => {
    const next = {};
    Object.keys(errors).forEach((key) => {
      if (touched[key] || saveState === "error") {
        next[key] = errors[key];
      }
    });
    return next;
  }, [errors, saveState, touched]);

  const profilePreview = useMemo(
    () => ({
      name: values.name || "Your profile",
      email: values.email || "No email",
      username: normalizedValues.username,
      supportLine: buildSupportLine(values),
      photoURL: localAvatarUri || values.photoURL || "",
    }),
    [localAvatarUri, normalizedValues.username, values]
  );

  const integrationsSummary = useMemo(
    () => [
      {
        key: "strava",
        label: "Strava",
        value: integrations.stravaConnected ? "Connected" : "Not connected",
        meta: integrations.stravaConnected
          ? formatRelativeSync(integrations.lastStravaSyncMs)
          : "Connect in Settings",
      },
      {
        key: "garmin",
        label: "Garmin",
        value: integrations.garminConnected ? "Connected" : "Not connected",
        meta: integrations.garminConnected
          ? "Training API connected"
          : "Manage connection in Settings",
      },
    ],
    [integrations]
  );

  const secondaryLinks = useMemo(
    () => [
      {
        key: "security",
        label: "Account & Security",
        meta: "Email, password, sign out, and app controls",
        path: "/settings",
      },
      {
        key: "imports",
        label: "Garmin Training API",
        meta: "Connection details and workout send history",
        path: "/profile/garmin-data",
      },
      {
        key: "analytics",
        label: "Analytics",
        meta: "Deeper stats and activity trends",
        value: "Soon",
      },
    ],
    []
  );

  const setField = useCallback((field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setSaveState("idle");
    setSaveMessage("");
  }, []);

  const blurField = useCallback((field) => {
    setTouched((current) => ({ ...current, [field]: true }));
  }, []);

  const pickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setSaveState("error");
      setSaveMessage("Allow photo access to update your profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setLocalAvatarUri(result.assets[0].uri);
      setSaveState("idle");
      setSaveMessage("");
    }
  }, []);

  const uploadAvatarIfNeeded = useCallback(async () => {
    if (!localAvatarUri || !user?.uid) return values.photoURL || "";
    const blob = await (await fetch(localAvatarUri)).blob();
    const avatarRef = ref(storage, `${AVATAR_FOLDER}/${user.uid}.jpg`);
    await uploadBytes(avatarRef, blob, { contentType: "image/jpeg" });
    return getDownloadURL(avatarRef);
  }, [localAvatarUri, storage, user?.uid, values.photoURL]);

  const saveProfile = useCallback(async () => {
    if (!user?.uid) {
      setSaveState("error");
      setSaveMessage("You need to be signed in to edit your profile.");
      return false;
    }

    setTouched({
      name: true,
      username: true,
      bio: true,
      sport: true,
      location: true,
      website: true,
    });

    const currentErrors = validateValues(values);
    if (Object.keys(currentErrors).length) {
      setSaveState("error");
      setSaveMessage("Fix the highlighted fields before saving.");
      return false;
    }

    try {
      setSaveState("saving");
      setSaveMessage("Saving profile…");

      if (
        initialValues &&
        normalizedValues.username &&
        normalizedValues.username !== initialValues.username
      ) {
        const available = await isUsernameAvailable(user.uid, normalizedValues.username);
        if (!available) {
          setTouched((current) => ({ ...current, username: true }));
          setSaveState("error");
          setSaveMessage("That username is already taken.");
          return false;
        }
      }

      const finalPhotoURL = await uploadAvatarIfNeeded();

      await updateProfile(user, {
        displayName: normalizedValues.name || user.displayName || "",
        photoURL: finalPhotoURL || user.photoURL || "",
      });

      await setDoc(
        doc(db, "public_profiles", user.uid),
        {
          uid: user.uid,
          name: normalizedValues.name || user.displayName || "",
          username: normalizedValues.username,
          bio: normalizedValues.bio,
          sport: normalizedValues.sport,
          location: normalizedValues.location,
          website: normalizedValues.website,
          photoURL: finalPhotoURL || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const nextValues = {
        ...values,
        ...normalizedValues,
        photoURL: finalPhotoURL || "",
      };
      setValues(nextValues);
      setInitialValues(normalizeForSave(nextValues));
      setLocalAvatarUri("");
      setSaveState("saved");
      setSaveMessage("Profile updated.");
      return true;
    } catch (error) {
      setSaveState("error");
      setSaveMessage(error?.message || "Could not save your profile.");
      return false;
    }
  }, [initialValues, normalizedValues, uploadAvatarIfNeeded, user, values]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  return {
    loading,
    refreshing,
    loadError,
    values,
    fieldErrors,
    dirty,
    hasErrors,
    saveState,
    saveMessage,
    profilePreview,
    integrationsSummary,
    secondaryLinks,
    setField,
    blurField,
    pickAvatar,
    saveProfile,
    refresh,
  };
}

export default useProfilePageData;
