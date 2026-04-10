// app/(protected)/nutrition/barcode.jsx

import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
    useLocalSearchParams,
    useNavigation,
    useRouter,
} from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useTheme } from "../../../providers/ThemeProvider";

export default function BarcodeScannerScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const params = useLocalSearchParams();

  // ✅ hide tab bar + header on focus (restore on blur)
  useFocusEffect(
    useCallback(() => {
      // hide React Navigation header for this screen (if any)
      navigation?.setOptions?.({ headerShown: false });

      // hide parent tab bar (if this screen sits inside a tabs layout)
      const parent = navigation?.getParent?.();
      parent?.setOptions?.({
        tabBarStyle: { display: "none" },
      });

      return () => {
        parent?.setOptions?.({
          tabBarStyle: undefined,
        });
      };
    }, [navigation])
  );

  const dateParam = useMemo(() => {
    const raw = typeof params.date === "string" ? params.date : null;
    const ok = raw && !Number.isNaN(new Date(raw).getTime());
    return ok ? raw : new Date().toISOString();
  }, [params.date]);

  const mealTypeParam = useMemo(() => {
    const raw = typeof params.mealType === "string" ? params.mealType : "";
    return raw.trim();
  }, [params.mealType]);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const s = makeStyles(colors, isDark, insets);

  const normaliseBarcode = useCallback((raw) => {
    const digits = String(raw || "").replace(/\D/g, "");
    return /^\d{8,18}$/.test(digits) ? digits : "";
  }, []);

  const handleBarCodeScanned = useCallback(
    ({ data, type }) => {
      if (scanned) return;
      setScanned(true);

      const code = normaliseBarcode(data);
      if (!code) {
        Alert.alert(
          "Unsupported code",
          "Please scan a standard EAN/UPC barcode.",
          [{ text: "OK", onPress: () => setScanned(false) }]
        );
        return;
      }

      Alert.alert(
        "Barcode scanned",
        `Type: ${type}\nCode: ${code}`,
        [
          { text: "Scan again", onPress: () => setScanned(false) },
          {
            text: "Continue",
            onPress: () => {
              // ✅ push to barcode-result screen (better UX than going straight to add)
              router.replace({
                pathname: "/nutrition/barcode-result",
                params: {
                  barcode: code,
                  date: dateParam,
                  mealType: mealTypeParam,
                },
              });
            },
          },
          { text: "Cancel", style: "cancel", onPress: () => router.back() },
        ],
        { cancelable: false }
      );
    },
    [router, scanned, dateParam, mealTypeParam, normaliseBarcode]
  );

  if (!permission) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.center}>
          <ActivityIndicator size="large" color="#E6FF3B" />
          <Text style={s.infoText}>Loading camera…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <View style={s.center}>
          <Text style={s.infoText}>
            Camera access is required to scan barcodes.
          </Text>

          <TouchableOpacity
            style={s.primaryButton}
            onPress={async () => {
              const result = await requestPermission();
              if (!result?.granted) {
                Linking.openSettings().catch(() => {});
              }
            }}
            activeOpacity={0.9}
          >
            <Text style={s.primaryButtonText}>Enable camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.backButton}
            onPress={() => router.back()}
            activeOpacity={0.9}
          >
            <Text style={s.backButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    // ✅ include bottom safe area so your view isn't clipped by home indicator
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={s.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.iconButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={22} color="#E6FF3B" />
        </TouchableOpacity>

        <Text style={s.headerTitle}>Scan barcode</Text>

        <View style={{ width: 32 }} />
      </View>

      {/* Scanner view */}
      <View style={s.scannerWrapper}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: [
              "ean13",
              "ean8",
              "upc_a",
              "upc_e",
              "code128",
              "code39",
              "code93",
              "itf14",
              "qr",
              "pdf417",
              "aztec",
              "datamatrix",
            ],
          }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />

        {/* Overlay */}
        <View style={s.overlay}>
          <View style={s.overlayTop} />

          <View style={s.overlayMiddleRow}>
            <View style={s.overlaySide} />
            <View style={s.scanBox}>
              <View style={s.scanCornerTL} />
              <View style={s.scanCornerTR} />
              <View style={s.scanCornerBL} />
              <View style={s.scanCornerBR} />
            </View>
            <View style={s.overlaySide} />
          </View>

          <View style={s.overlayBottom}>
            <Text style={s.overlayText}>Align the barcode inside the frame</Text>

            {scanned && (
              <TouchableOpacity
                style={s.rescanButton}
                onPress={() => setScanned(false)}
                activeOpacity={0.9}
              >
                <Text style={s.rescanText}>Tap to scan again</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* ✅ hard spacer so even if a custom footer exists, your scanner never sits behind it */}
      <View style={{ height: s.__bottomSpacerHeight }} />
    </SafeAreaView>
  );
}

function makeStyles(colors, isDark, insets) {
  const PRIMARY = "#E6FF3B";

  // If your “footer” is custom and still shows, this guarantees clearance.
  const CUSTOM_FOOTER_HEIGHT_GUESS = 96;
  const bottomSpacerHeight = CUSTOM_FOOTER_HEIGHT_GUESS + insets.bottom;

  return {
    __bottomSpacerHeight: bottomSpacerHeight,
    ...StyleSheet.create({
      safe: {
        flex: 1,
        backgroundColor: isDark ? "#050506" : "#000000",
      },
      center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      },
      infoText: {
        marginTop: 12,
        color: colors.text,
        textAlign: "center",
        fontSize: 14,
        lineHeight: 20,
      },

      primaryButton: {
        marginTop: 16,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: PRIMARY,
      },
      primaryButtonText: {
        color: "#111111",
        fontWeight: "800",
        letterSpacing: 0.3,
      },

      backButton: {
        marginTop: 10,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PRIMARY,
        backgroundColor: "transparent",
      },
      backButtonText: {
        color: PRIMARY,
        fontWeight: "700",
        letterSpacing: 0.3,
      },

      headerRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 18,
        paddingTop: 4,
        paddingBottom: 10,
      },
      iconButton: {
        width: 32,
        height: 32,
        alignItems: "center",
        justifyContent: "center",
      },
      headerTitle: {
        flex: 1,
        textAlign: "center",
        fontSize: 18,
        fontWeight: "800",
        letterSpacing: 0.8,
        color: "#F9FAFB",
        textTransform: "uppercase",
      },

      scannerWrapper: {
        flex: 1,
        marginHorizontal: 16,
        borderRadius: 24,
        overflow: "hidden",
        backgroundColor: "#000",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.08)",
      },

      overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: "space-between",
      },
      overlayTop: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
      },
      overlayMiddleRow: {
        flexDirection: "row",
        alignItems: "center",
      },
      overlaySide: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.45)",
      },

      scanBox: {
        width: 260,
        height: 160,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.18)",
        overflow: "hidden",
      },

      scanCornerTL: {
        position: "absolute",
        top: 0,
        left: 0,
        width: 26,
        height: 26,
        borderTopWidth: 3,
        borderLeftWidth: 3,
        borderColor: PRIMARY,
        borderTopLeftRadius: 24,
      },
      scanCornerTR: {
        position: "absolute",
        top: 0,
        right: 0,
        width: 26,
        height: 26,
        borderTopWidth: 3,
        borderRightWidth: 3,
        borderColor: PRIMARY,
        borderTopRightRadius: 24,
      },
      scanCornerBL: {
        position: "absolute",
        bottom: 0,
        left: 0,
        width: 26,
        height: 26,
        borderBottomWidth: 3,
        borderLeftWidth: 3,
        borderColor: PRIMARY,
        borderBottomLeftRadius: 24,
      },
      scanCornerBR: {
        position: "absolute",
        bottom: 0,
        right: 0,
        width: 26,
        height: 26,
        borderBottomWidth: 3,
        borderRightWidth: 3,
        borderColor: PRIMARY,
        borderBottomRightRadius: 24,
      },

      overlayBottom: {
        paddingTop: 12,
        paddingHorizontal: 18,
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.55)",
        paddingBottom: insets.bottom + 14,
      },
      overlayText: {
        color: "#E5E7EB",
        fontSize: 14,
      },
      rescanButton: {
        marginTop: 10,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PRIMARY,
        backgroundColor: "rgba(0,0,0,0.2)",
      },
      rescanText: {
        color: PRIMARY,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 0.3,
      },
    }),
  };
}
