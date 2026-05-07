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

function cleanNumberText(value) {
  return String(value || "").replace(/[^0-9.]/g, "").trim();
}

function numberOrNull(value) {
  const raw = cleanNumberText(value);
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function hasInvalidNumber(value) {
  const raw = cleanNumberText(value);
  return !!raw && !/^\d+(\.\d+)?$/.test(raw);
}

function normalizeDob(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function ageFromDob(dobISO) {
  const raw = String(dobISO || "").trim();
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 10 && age <= 100 ? age : null;
}

function estimateMaxHrFromAge(age) {
  const value = Number(age);
  if (!Number.isFinite(value) || value < 10 || value > 100) return null;
  return Math.round(208 - 0.7 * value);
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
  const dobISO = normalizeDob(values.dobISO);
  const heightCm = numberOrNull(values.heightCm);
  const weightKg = numberOrNull(values.weightKg);
  const maxHR = numberOrNull(values.maxHR);
  const restingHR = numberOrNull(values.restingHR);
  const thresholdHR = numberOrNull(values.thresholdHR);
  const trainingBackground = cleanText(values.trainingBackground);

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

  if (dobISO) {
    const match = dobISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = match ? new Date(`${dobISO}T00:00:00.000Z`) : null;
    const age = date ? Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
    if (!match || !date || Number.isNaN(date.getTime())) {
      next.dobISO = "Use YYYY-MM-DD.";
    } else if (age < 10 || age > 100) {
      next.dobISO = "Enter a realistic date of birth.";
    }
  }

  if (hasInvalidNumber(values.heightCm)) {
    next.heightCm = "Enter a number in cm.";
  } else if (heightCm != null && (heightCm < 80 || heightCm > 250)) {
    next.heightCm = "Use height in cm, between 80 and 250.";
  }

  if (hasInvalidNumber(values.weightKg)) {
    next.weightKg = "Enter a number in kg.";
  } else if (weightKg != null && (weightKg < 25 || weightKg > 250)) {
    next.weightKg = "Use weight in kg, between 25 and 250.";
  }

  if (hasInvalidNumber(values.maxHR)) {
    next.maxHR = "Enter a whole number in bpm.";
  } else if (maxHR != null && (maxHR < 120 || maxHR > 230)) {
    next.maxHR = "Max HR should be between 120 and 230 bpm.";
  }

  if (hasInvalidNumber(values.restingHR)) {
    next.restingHR = "Enter a whole number in bpm.";
  } else if (restingHR != null && (restingHR < 30 || restingHR > 100)) {
    next.restingHR = "Resting HR should be between 30 and 100 bpm.";
  }

  if (hasInvalidNumber(values.thresholdHR)) {
    next.thresholdHR = "Enter a whole number in bpm.";
  } else if (thresholdHR != null && (thresholdHR < 80 || thresholdHR > 220)) {
    next.thresholdHR = "Threshold HR should be between 80 and 220 bpm.";
  }

  if (maxHR != null && restingHR != null && restingHR >= maxHR) {
    next.restingHR = "Resting HR must be below max HR.";
  }

  if (maxHR != null && thresholdHR != null && thresholdHR >= maxHR) {
    next.thresholdHR = "Threshold HR should be below max HR.";
  }

  if (trainingBackground.length > 500) {
    next.trainingBackground = "Keep this under 500 characters.";
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
    dobISO: normalizeDob(values.dobISO),
    sex: cleanText(values.sex),
    heightCm: cleanNumberText(values.heightCm),
    weightKg: cleanNumberText(values.weightKg),
    maxHR: cleanNumberText(values.maxHR),
    restingHR: cleanNumberText(values.restingHR),
    thresholdHR: cleanNumberText(values.thresholdHR),
    trainingBackground: cleanText(values.trainingBackground),
  };
}

function buildPrivateAthleteProfile(values) {
  const age = ageFromDob(values.dobISO);
  const enteredMaxHR = numberOrNull(values.maxHR);
  const estimatedMaxHR = estimateMaxHrFromAge(age);
  const maxHR = enteredMaxHR ?? estimatedMaxHR;
  const restingHR = numberOrNull(values.restingHR);
  const thresholdHR = numberOrNull(values.thresholdHR);

  return {
    dobISO: normalizeDob(values.dobISO) || null,
    age,
    sex: cleanText(values.sex) || null,
    heightCm: numberOrNull(values.heightCm),
    weightKg: numberOrNull(values.weightKg),
    maxHR,
    enteredMaxHR,
    estimatedMaxHR,
    maxHRSource: enteredMaxHR != null ? "manual" : estimatedMaxHR != null ? "age_estimate" : null,
    restingHR,
    thresholdHR,
    hr: {
      max: maxHR,
      enteredMax: enteredMaxHR,
      estimatedMax: estimatedMaxHR,
      maxSource: enteredMaxHR != null ? "manual" : estimatedMaxHR != null ? "age_estimate" : null,
      resting: restingHR,
      threshold: thresholdHR,
    },
    trainingBackground: cleanText(values.trainingBackground) || null,
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
    dobISO: "",
    sex: "",
    heightCm: "",
    weightKg: "",
    maxHR: "",
    restingHR: "",
    thresholdHR: "",
    trainingBackground: "",
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
      const athleteProfile = userData?.athleteProfile || {};
      const maxHRWasEstimated =
        athleteProfile?.maxHRSource === "age_estimate" ||
        athleteProfile?.hr?.maxSource === "age_estimate";

      const nextValues = {
        name: user?.displayName || profileData?.name || "",
        username: profileData?.username || profileData?.handle || "",
        bio: profileData?.bio || "",
        sport: profileData?.sport || "",
        location: profileData?.location || "",
        website: profileData?.website || "",
        dobISO: athleteProfile?.dobISO || athleteProfile?.dob || "",
        sex: athleteProfile?.sex || "",
        heightCm: athleteProfile?.heightCm != null ? String(athleteProfile.heightCm) : "",
        weightKg: athleteProfile?.weightKg != null ? String(athleteProfile.weightKg) : "",
        maxHR:
          maxHRWasEstimated
            ? ""
            : athleteProfile?.maxHR != null
            ? String(athleteProfile.maxHR)
            : athleteProfile?.hr?.max != null
            ? String(athleteProfile.hr.max)
            : "",
        restingHR:
          athleteProfile?.restingHR != null
            ? String(athleteProfile.restingHR)
            : athleteProfile?.hr?.resting != null
            ? String(athleteProfile.hr.resting)
            : "",
        thresholdHR:
          athleteProfile?.thresholdHR != null
            ? String(athleteProfile.thresholdHR)
            : athleteProfile?.hr?.threshold != null
            ? String(athleteProfile.hr.threshold)
            : "",
        trainingBackground: athleteProfile?.trainingBackground || "",
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
        garminConnected:
          userData?.integrations?.garminActivity?.connected === true ||
          userData?.integrations?.garmin?.connected === true,
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
      dobISO: true,
      sex: true,
      heightCm: true,
      weightKg: true,
      maxHR: true,
      restingHR: true,
      thresholdHR: true,
      trainingBackground: true,
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

      const privateAthleteProfile = buildPrivateAthleteProfile(normalizedValues);

      await setDoc(
        doc(db, "users", user.uid),
        {
          name: normalizedValues.name || user.displayName || "",
          email: user.email || "",
          photoURL: finalPhotoURL || "",
          athleteProfile: {
            ...privateAthleteProfile,
            updatedAt: serverTimestamp(),
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "users", user.uid, "planPrefs", "current"),
        {
          dobISO: privateAthleteProfile.dobISO,
          sex: privateAthleteProfile.sex,
          heightCm: privateAthleteProfile.heightCm,
          weightKg: privateAthleteProfile.weightKg,
          maxHR: privateAthleteProfile.maxHR,
          enteredMaxHR: privateAthleteProfile.enteredMaxHR,
          estimatedMaxHR: privateAthleteProfile.estimatedMaxHR,
          maxHRSource: privateAthleteProfile.maxHRSource,
          restingHR: privateAthleteProfile.restingHR,
          thresholdHR: privateAthleteProfile.thresholdHR,
          hr: privateAthleteProfile.hr,
          trainingBackground: privateAthleteProfile.trainingBackground,
          athleteProfileUpdatedAt: serverTimestamp(),
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
