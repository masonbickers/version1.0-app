import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { AntDesign } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import {
  getAdditionalUserInfo,
  OAuthProvider,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AppIcon from "../../assets/images/icon.png";
import LoginHero from "../../assets/images/auth/img_auth_login_hero.jpg";
import AuthScreenShell, {
  createAuthStyles,
} from "../../components/auth/AuthScreenShell";
import { auth, db } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const looksLikeEmail = (s) => /\S+@\S+\.\S+/.test(String(s || ""));
const normaliseUsername = (u) => String(u || "").trim().toLowerCase();

const mapAuthError = (e) => {
  const code = e?.code || e?.message || "";
  if (code.includes("auth/invalid-credential"))
    return "Email/username or password is incorrect.";
  if (code.includes("auth/user-not-found")) return "Account not found.";
  if (code.includes("auth/wrong-password"))
    return "Email/username or password is incorrect.";
  if (code.includes("auth/too-many-requests"))
    return "Too many attempts. Please try again later.";
  if (code.includes("permission-denied"))
    return "Permission denied by Firestore rules.";
  return e?.message || "Please try again.";
};

const sha256 = (t) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, t);
const randomNonce = (len = 32) => {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._";
  let out = "";
  Crypto.getRandomBytes(len).forEach((v) => (out += chars[v % chars.length]));
  return out;
};

export default function SignIn() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const s = useMemo(() => createAuthStyles(colors, isDark), [colors, isDark]);
  const local = useMemo(() => makeStyles(colors), [colors]);
  const placeholderColor = "#6B7280";
  const selectionColor = colors.accentBg || colors.sapPrimary || "#E6FF3B";
  const landingBackgroundColors = isDark
    ? ["#030303", "#0A0B0F", "#16181D"]
    : ["#0A0A0A", "#17191F", "#2A2D35"];

  const [id, setId] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const [formError, setFormError] = useState("");
  const [idErr, setIdErr] = useState("");
  const [passErr, setPassErr] = useState("");

  const showError = (msg) => {
    setFormError(msg);
    try {
      Alert.alert("Sign-in error", msg);
    } catch {}
  };

  const clearErrors = () => {
    setFormError("");
    setIdErr("");
    setPassErr("");
  };

  useEffect(() => {
    (async () => {
      const ok =
        Platform.OS === "ios" &&
        (await AppleAuthentication.isAvailableAsync());
      setAppleAvailable(ok);
    })();
  }, []);

  const resolveEmail = async (input) => {
    if (looksLikeEmail(input)) return input.trim();

    const uname = normaliseUsername(input);
    const snap = await getDoc(doc(db, "usernames", uname));
    if (!snap.exists()) throw new Error("No account found for that username.");
    const email = snap.data()?.email;
    if (!email) throw new Error("Email not found for this account.");
    return String(email).trim();
  };

  const onLogin = async () => {
    clearErrors();

    if (!id.trim()) {
      setIdErr("Enter your email or username.");
      return showError("Please enter your email or username.");
    }
    if (!pass) {
      setPassErr("Enter your password.");
      return showError("Please enter your password.");
    }

    try {
      setBusy(true);
      const email = await resolveEmail(id);
      await signInWithEmailAndPassword(auth, email, pass);
      router.replace("/(protected)/home");
    } catch (e) {
      console.error("Login failed:", e);
      const msg = mapAuthError(e);
      showError(msg);
      if (
        String(e?.message || "").toLowerCase().includes("username") ||
        String(e?.message || "").toLowerCase().includes("email")
      ) {
        setIdErr(msg);
      } else if (msg.toLowerCase().includes("password")) {
        setPassErr(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    clearErrors();

    if (!id.trim()) {
      setIdErr("Enter your email or username first.");
      return showError("Please enter your email or username first.");
    }

    try {
      setBusy(true);
      const email = await resolveEmail(id);
      await sendPasswordResetEmail(auth, email);
      Alert.alert("Reset email sent", "Check your inbox for reset instructions.");
    } catch (e) {
      console.error("Reset failed:", e);
      const msg = mapAuthError(e);
      showError(msg);
      setIdErr(msg);
    } finally {
      setBusy(false);
    }
  };

  const onAppleLogin = async () => {
    clearErrors();

    try {
      setBusy(true);

      const rawNonce = randomNonce();
      const hashedNonce = await sha256(rawNonce);

      const res = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!res.identityToken) throw new Error("No identity token from Apple.");

      const provider = new OAuthProvider("apple.com");
      const credential = provider.credential({
        idToken: res.identityToken,
        rawNonce,
      });

      const result = await signInWithCredential(auth, credential);
      const isNew = getAdditionalUserInfo(result)?.isNewUser;

      const fullName =
        res.fullName?.givenName || res.fullName?.familyName
          ? `${res.fullName?.givenName ?? ""} ${
              res.fullName?.familyName ?? ""
            }`.trim()
          : null;

      if (isNew && fullName) {
        try {
          await updateProfile(result.user, { displayName: fullName });
        } catch {}
      }

      if (isNew) {
        await setDoc(
          doc(db, "users", result.user.uid),
          {
            uid: result.user.uid,
            email: result.user.email ?? null,
            name: fullName ?? result.user.displayName ?? "",
            welcomeSeen: false,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      router.replace("/(protected)");
    } catch (e) {
      console.error("Apple sign-in failed:", e);
      const msg = String(e?.message || "")
        .toLowerCase()
        .includes("canceled")
        ? "Apple sign-in cancelled."
        : e?.message || "Could not sign in with Apple.";
      showError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onGoogleLogin = () => {
    Alert.alert(
      "Google sign-in not wired yet",
      "The Google button is now on the page, but the native Google auth flow is not configured in this build yet."
    );
  };

  return (
    <AuthScreenShell
      heroSource={LoginHero}
      brandSource={AppIcon}
      kicker={null}
      title="WELCOME"
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
          <View style={[s.inputShell, !!idErr && s.inputShellError]}>
            <TextInput
              style={s.input}
              placeholder="Email address"
              placeholderTextColor={placeholderColor}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              selectionColor={selectionColor}
              cursorColor={selectionColor}
              value={id}
              onChangeText={(t) => {
                setId(t);
                if (idErr) setIdErr("");
              }}
            />
          </View>
          {!!idErr && <Text style={s.fieldError}>{idErr}</Text>}
        </View>

        <View style={s.fieldGroup}>
          <View style={[s.inputShell, !!passErr && s.inputShellError]}>
            <TextInput
              style={s.input}
              placeholder="Enter password"
              placeholderTextColor={placeholderColor}
              secureTextEntry
              autoComplete="password"
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
          onPress={onLogin}
          disabled={busy}
          activeOpacity={0.9}
        >
          <Text style={s.primaryBtnText}>
            {busy ? "Please wait…" : "Sign in"}
          </Text>
        </TouchableOpacity>

        <View style={local.socialRow}>
          <TouchableOpacity
            style={[local.socialBtn, local.googleBtn, busy && local.socialBtnDisabled]}
            onPress={onGoogleLogin}
            disabled={busy}
            activeOpacity={0.9}
          >
            <AntDesign name="google" size={16} color="#FFFFFF" />
            <Text style={local.socialBtnText}>Google</Text>
          </TouchableOpacity>

          {appleAvailable && (
            <TouchableOpacity
              style={[local.socialBtn, local.appleBtn, busy && local.socialBtnDisabled]}
              onPress={onAppleLogin}
              disabled={busy}
              activeOpacity={0.9}
            >
              <AntDesign name="apple" size={16} color="#FFFFFF" />
              <Text style={local.socialBtnText}>Apple</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={s.footerRow}>
        <TouchableOpacity
          onPress={onForgot}
          disabled={busy}
          style={s.footerBtn}
          activeOpacity={0.9}
        >
          <Text style={s.footerBtnText}>Forgot password?</Text>
        </TouchableOpacity>

        <View style={s.footerMeta}>
          <Text style={s.footerPrompt}>Don't have an account?</Text>
          <Link href="/(auth)/signup" asChild>
            <TouchableOpacity activeOpacity={0.85}>
              <Text style={s.footerLink}>Sign up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </AuthScreenShell>
  );
}

function makeStyles(colors) {
  const accent = colors?.accentBg || colors?.sapPrimary || "#E6FF3B";

  return StyleSheet.create({
    socialRow: {
      width: "100%",
      gap: 10,
      marginTop: 10,
    },
    socialBtn: {
      height: 42,
      borderRadius: 4,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    googleBtn: {
      backgroundColor: "rgba(20,20,22,0.90)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.22)",
    },
    appleBtn: {
      backgroundColor: "rgba(20,20,22,0.90)",
      borderWidth: 1,
      borderColor: accent,
      width: "100%",
    },
    socialBtnDisabled: {
      opacity: 0.6,
    },
    socialBtnText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "700",
    },
  });
}
