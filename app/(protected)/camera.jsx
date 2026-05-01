import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../../providers/ThemeProvider";

export default function CameraPage() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const [photoUri, setPhotoUri] = useState("");
  const [cameraFacing, setCameraFacing] = useState("back");

  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const onRequestPermission = async () => {
    const result = await requestPermission();
    if (!result?.granted) {
      Alert.alert("Camera permission needed", "Enable camera access to use this screen.");
    }
  };

  const onCapture = async () => {
    if (isCapturing) return;
    if (!cameraRef.current) return;
    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
      });
      setPhotoUri(String(photo?.uri || ""));
    } catch (error) {
      Alert.alert("Capture failed", String(error?.message || error || "Unknown error"));
    } finally {
      setIsCapturing(false);
    }
  };

  const onFlip = () => {
    setCameraFacing((prev) => (prev === "back" ? "front" : "back"));
  };

  if (!permission) {
    return (
      <SafeAreaView style={s.loadingWrap}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.permissionWrap}>
        <Text style={s.permissionTitle}>Camera Access Needed</Text>
        <Text style={s.permissionText}>
          To open your in-app camera from a lock screen/control shortcut, allow camera access.
        </Text>
        <TouchableOpacity style={s.primaryBtn} onPress={onRequestPermission} activeOpacity={0.85}>
          <Text style={s.primaryBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.screen}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={cameraFacing} />

      <SafeAreaView style={s.overlay} edges={["top", "left", "right", "bottom"]}>
        <View style={s.topBar}>
          <TouchableOpacity
            style={s.iconBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Feather name="x" size={20} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={s.iconBtn} onPress={onFlip} activeOpacity={0.85}>
            <Feather name="refresh-ccw" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={s.bottomBar}>
          <TouchableOpacity
            style={[s.shutterOuter, isCapturing && s.shutterOuterDisabled]}
            onPress={onCapture}
            activeOpacity={0.9}
            disabled={isCapturing}
          >
            {isCapturing ? <ActivityIndicator color="#000" /> : <View style={s.shutterInner} />}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {photoUri ? (
        <View style={s.previewCard}>
          <Image source={{ uri: photoUri }} style={s.previewImage} />
          <View style={s.previewActions}>
            <TouchableOpacity
              style={[s.previewBtn, s.previewBtnGhost]}
              onPress={() => setPhotoUri("")}
              activeOpacity={0.85}
            >
              <Text style={s.previewBtnGhostText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.previewBtn, s.previewBtnPrimary]}
              onPress={() => {
                Alert.alert("Saved locally", "Photo captured. Hook this into your upload flow next.");
              }}
              activeOpacity={0.85}
            >
              <Text style={s.previewBtnPrimaryText}>Use Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors, isDark) {
  const accent = colors?.accentBg || colors?.sapPrimary || "#E6FF3B";
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#000" },
    overlay: {
      flex: 1,
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 28,
    },
    topBar: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    iconBtn: {
      height: 40,
      width: 40,
      borderRadius: 20,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    bottomBar: {
      alignItems: "center",
      justifyContent: "center",
    },
    shutterOuter: {
      height: 78,
      width: 78,
      borderRadius: 39,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
    },
    shutterOuterDisabled: { opacity: 0.7 },
    shutterInner: {
      height: 52,
      width: 52,
      borderRadius: 26,
      backgroundColor: "#111",
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.9)",
    },
    previewCard: {
      position: "absolute",
      bottom: 120,
      right: 16,
      width: 132,
      borderRadius: 16,
      overflow: "hidden",
      backgroundColor: isDark ? "#13141A" : "#fff",
      borderWidth: 1,
      borderColor: colors?.border || "rgba(255,255,255,0.2)",
    },
    previewImage: {
      width: "100%",
      height: 96,
      backgroundColor: "#111",
    },
    previewActions: {
      padding: 8,
      gap: 6,
    },
    previewBtn: {
      minHeight: 34,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8,
    },
    previewBtnGhost: {
      borderWidth: 1,
      borderColor: colors?.border || "#D1D5DB",
      backgroundColor: "transparent",
    },
    previewBtnGhostText: {
      color: colors?.text || "#111827",
      fontSize: 12,
      fontWeight: "700",
    },
    previewBtnPrimary: {
      backgroundColor: accent,
    },
    previewBtnPrimaryText: {
      color: "#101010",
      fontSize: 12,
      fontWeight: "800",
    },
    permissionWrap: {
      flex: 1,
      paddingHorizontal: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
      gap: 10,
    },
    permissionTitle: {
      color: colors?.text || "#0F172A",
      fontSize: 22,
      fontWeight: "800",
      textAlign: "center",
    },
    permissionText: {
      color: colors?.subtext || "#64748B",
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      maxWidth: 320,
    },
    primaryBtn: {
      marginTop: 8,
      minHeight: 46,
      borderRadius: 14,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: accent,
    },
    primaryBtnText: {
      color: "#111",
      fontWeight: "800",
      fontSize: 14,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: isDark ? "#050506" : "#F5F5F7",
    },
  });
}
