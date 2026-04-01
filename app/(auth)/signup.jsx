import { Link, useRouter } from "expo-router";
import { createUserWithEmailAndPassword, deleteUser, updateProfile } from "firebase/auth";
import { doc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { useMemo, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AppIcon from "../../assets/images/icon.png";
import AuthScreenShell, {
  createAuthStyles,
} from "../../components/auth/AuthScreenShell";
import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const looksLikeEmail = (s) => /\S+@\S+\.\S+/.test(String(s || ""));
const normaliseUsername = (u) => String(u || "").trim().toLowerCase();
const validUsername = (u) => /^[a-z0-9_.]{3,24}$/.test(u); // a–z 0–9 _ .
const cleanUsernamePart = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/^[._]+|[._]+$/g, "");

const buildUsernameBase = (firstName, lastName, email) => {
  const fromName = cleanUsernamePart(`${firstName}${lastName}`);
  const fromEmail = cleanUsernamePart(String(email || "").split("@")[0]);
  const base = fromName || fromEmail || "athlete";
  const padded = base.length >= 3 ? base : `${base}athlete`;
  return padded.slice(0, 18);
};

const mapFirebaseError = (e) => {
  const code = e?.code || e?.message || "";
  if (code.includes("USERNAME_TAKEN")) return "That username is taken. Try another.";
  if (code.includes("auth/email-already-in-use")) return "That email is already in use.";
  if (code.includes("auth/invalid-email")) return "That email address looks invalid.";
  if (code.includes("auth/operation-not-allowed"))
    return "Email/password sign-in isn’t enabled for this project.";
  if (code.includes("auth/weak-password")) return "Password is too weak (min 6 characters).";
  if (code.includes("permission-denied")) return "Permission denied by Firestore rules.";
  return e?.message || "Please try again.";
};

export default function Signup() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => createAuthStyles(colors, isDark), [colors, isDark]);
  const placeholderColor = "#6B7280";
  const selectionColor = colors.accentBg || colors.sapPrimary || "#E6FF3B";
  const local = useMemo(() => makeStyles(), []);
  const landingBackgroundColors = isDark
    ? ["#030303", "#0A0B0F", "#16181D"]
    : ["#0A0A0A", "#17191F", "#2A2D35"];

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  // visible error banner + small field errors
  const [formError, setFormError] = useState("");
  const [firstNameErr, setFirstNameErr] = useState("");
  const [lastNameErr, setLastNameErr] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [passErr, setPassErr] = useState("");

  const showError = (msg) => {
    setFormError(msg);
    try {
      Alert.alert("Signup error", msg);
    } catch {}
  };

  const clearFieldErrors = () => {
    setFormError("");
    setFirstNameErr("");
    setLastNameErr("");
    setEmailErr("");
    setPassErr("");
  };

  const onSignup = async () => {
    clearFieldErrors();

    // client-side validation (also sets inline errors + banner)
    if (!firstName.trim()) {
      setFirstNameErr("Enter your first name.");
      return showError("Please enter your first name.");
    }
    if (!lastName.trim()) {
      setLastNameErr("Enter your last name.");
      return showError("Please enter your last name.");
    }
    if (!looksLikeEmail(email)) {
      setEmailErr("Enter a valid email address.");
      return showError("Invalid email address.");
    }
    if (pass.length < 6) {
      setPassErr("Minimum 6 characters.");
      return showError("Password too short (min 6).");
    }

    let cred;
    try {
      setBusy(true);
      const emailValue = email.trim().toLowerCase();
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

      // create auth user
      cred = await createUserWithEmailAndPassword(auth, emailValue, pass);

      // atomically claim username (prevents duplicates)
      let username = "";
      await runTransaction(db, async (tx) => {
        const base = buildUsernameBase(firstName, lastName, emailValue);

        for (let i = 0; i < 40; i += 1) {
          const suffix = i === 0 ? "" : String(i + 1);
          const candidate = normaliseUsername(
            `${base.slice(0, 24 - suffix.length)}${suffix}`
          );
          if (!validUsername(candidate)) continue;

          const unameRef = doc(db, "usernames", candidate);
          const snap = await tx.get(unameRef);
          if (snap.exists()) continue;

          tx.set(unameRef, {
            uid: cred.user.uid,
            email: emailValue,
            createdAt: serverTimestamp(),
          });
          username = candidate;
          return;
        }

        throw new Error("USERNAME_TAKEN");
      });

      // set display name on auth profile
      await updateProfile(cred.user, { displayName: fullName });

      // create user profile
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email: cred.user.email,
        name: fullName,
        username,
        welcomeSeen: false,
        createdAt: serverTimestamp(),
      });

      router.replace("/(protected)");
    } catch (e) {
      // clean up orphaned auth user if username claim or profile write failed
      if (cred?.user) {
        try { await deleteUser(cred.user); } catch {}
      }
      const msg = mapFirebaseError(e);
      showError(msg);
      if (msg.toLowerCase().includes("username")) setEmailErr("Please try a different email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell
      brandSource={AppIcon}
      kicker={null}
      title="SIGN UP"
      subtitle={null}
      ghostTitle={null}
      disableScroll
      centered
      backgroundColors={landingBackgroundColors}
      backgroundStart={{ x: 0.08, y: 0.04 }}
      backgroundEnd={{ x: 0.92, y: 1 }}
    >
      <View style={s.formCard}>
        {!!formError && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{formError}</Text>
          </View>
        )}

        <View style={s.fieldGroup}>
          <View style={[s.inputShell, !!emailErr && s.inputShellError]}>
            <TextInput
              style={s.input}
              placeholder="Email Address"
              placeholderTextColor={placeholderColor}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              selectionColor={selectionColor}
              cursorColor={selectionColor}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (emailErr) setEmailErr("");
              }}
            />
          </View>
          {!!emailErr && <Text style={s.fieldError}>{emailErr}</Text>}
        </View>

        <View style={local.row}>
          <View style={local.half}>
            <View style={[s.inputShell, !!firstNameErr && s.inputShellError]}>
              <TextInput
                style={s.input}
                placeholder="First Name"
                placeholderTextColor={placeholderColor}
                autoCapitalize="words"
                autoComplete="name-given"
                selectionColor={selectionColor}
                cursorColor={selectionColor}
                value={firstName}
                onChangeText={(t) => {
                  setFirstName(t);
                  if (firstNameErr) setFirstNameErr("");
                }}
              />
            </View>
            {!!firstNameErr && <Text style={s.fieldError}>{firstNameErr}</Text>}
          </View>

          <View style={local.half}>
            <View style={[s.inputShell, !!lastNameErr && s.inputShellError]}>
              <TextInput
                style={s.input}
                placeholder="Last Name"
                placeholderTextColor={placeholderColor}
                autoCapitalize="words"
                autoComplete="name-family"
                selectionColor={selectionColor}
                cursorColor={selectionColor}
                value={lastName}
                onChangeText={(t) => {
                  setLastName(t);
                  if (lastNameErr) setLastNameErr("");
                }}
              />
            </View>
            {!!lastNameErr && <Text style={s.fieldError}>{lastNameErr}</Text>}
          </View>
        </View>

        <View style={s.fieldGroup}>
          <View style={[s.inputShell, !!passErr && s.inputShellError]}>
            <TextInput
              style={s.input}
              placeholder="Password"
              placeholderTextColor={placeholderColor}
              secureTextEntry
              autoComplete="new-password"
              selectionColor={selectionColor}
              cursorColor={selectionColor}
              value={pass}
              onChangeText={(t) => {
                setPass(t);
                if (passErr) setPassErr("");
              }}
            />
          </View>
          {!!passErr && <Text style={s.fieldError}>{passErr}</Text>}
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, busy && s.primaryBtnDisabled]}
          onPress={onSignup}
          disabled={busy}
          activeOpacity={0.9}
        >
          <Text style={s.primaryBtnText}>
            {busy ? "Please wait…" : "Sign up"}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={s.footerRow}>
        <View style={s.footerMeta}>
          <Text style={s.footerPrompt}>Already have an account?</Text>
          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity activeOpacity={0.85}>
              <Text style={s.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </AuthScreenShell>
  );
}

function makeStyles() {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 8,
    },
    half: {
      flex: 1,
    },
  });
}
