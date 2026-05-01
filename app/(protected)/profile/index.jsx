"use client";

import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ProfileForm from "../../../components/profile/ProfileForm";
import ProfileHeader from "../../../components/profile/ProfileHeader";
import IntegrationsSummary from "../../../components/profile/IntegrationsSummary";
import SecondaryLinks from "../../../components/profile/SecondaryLinks";
import { useTheme } from "../../../providers/ThemeProvider";
import { useProfilePageData } from "../../../src/hooks/useProfilePageData";

export default function EditProfilePage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const {
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
  } = useProfilePageData();

  const accentBg = colors?.accentBg || colors?.sapPrimary || "#E6FF3B";
  const styles = useMemo(
    () => makeStyles(colors, isDark, accentBg),
    [colors, isDark, accentBg]
  );

  const openSecondary = (item) => {
    if (!item?.path) return;
    router.push(item.path);
  };

  return (
    <View style={[styles.safe, { paddingTop: insets.top }]}>
      <View style={styles.page}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <ProfileHeader
            profile={profilePreview}
            colors={colors}
            styles={styles}
            onBack={() => router.back()}
            onEditPhoto={pickAvatar}
          />

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator />
              <Text style={[styles.loadingText, { color: colors.subtext }]}>
                Loading your profile…
              </Text>
            </View>
          ) : (
            <>
              {!!loadError && (
                <Text style={[styles.errorText, { color: colors.danger || "#EF4444" }]}>
                  {loadError}
                </Text>
              )}

              <ProfileForm
                values={values}
                errors={fieldErrors}
                colors={colors}
                styles={styles}
                dirty={dirty}
                hasErrors={hasErrors}
                saveState={saveState}
                saveMessage={saveMessage}
                onChangeField={setField}
                onBlurField={blurField}
                onSave={saveProfile}
              />

              <IntegrationsSummary
                items={integrationsSummary}
                colors={colors}
                styles={styles}
                onPressItem={(item) =>
                  router.push(item.key === "garmin" ? "/profile/garmin-data" : "/settings")
                }
              />

              <SecondaryLinks
                items={secondaryLinks}
                colors={colors}
                styles={styles}
                onPressItem={openSecondary}
              />

              <View style={styles.refreshRow}>
                <Text style={[styles.refreshHint, { color: colors.subtext }]}>
                  Security changes live in Settings. Import details live in the linked data tools.
                </Text>
                <Text
                  style={[
                    styles.refreshLink,
                    { color: refreshing ? colors.subtext : colors.text },
                  ]}
                  onPress={refresh}
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(colors, isDark, accentBg) {
  const divider = isDark ? "rgba(255,255,255,0.08)" : "rgba(17,17,17,0.08)";
  const subtle = "rgba(255,255,255,0.04)";
  const inputSurface = "rgba(255,255,255,0.045)";

  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: "#000000",
    },
    page: {
      flex: 1,
      paddingHorizontal: 20,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingBottom: 144,
      gap: 32,
    },
    headerWrap: {
      paddingTop: 10,
      gap: 20,
    },
    headerTopRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    backButton: {
      minHeight: 34,
      paddingHorizontal: 12,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: subtle,
    },
    backButtonText: {
      fontSize: 13,
      fontWeight: "700",
    },
    headerTopLabel: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.9,
    },
    headerMain: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 16,
    },
    avatarRing: {
      width: 82,
      height: 82,
      borderRadius: 24,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
      overflow: "hidden",
    },
    avatar: {
      width: "100%",
      height: "100%",
    },
    avatarFallback: {
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: {
      fontSize: 32,
      fontWeight: "900",
    },
    headerCopy: {
      flex: 1,
      gap: 5,
      paddingTop: 1,
    },
    headerEyebrow: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    headerName: {
      fontSize: 28,
      lineHeight: 32,
      fontWeight: "800",
      letterSpacing: -0.8,
    },
    headerMeta: {
      fontSize: 13,
      lineHeight: 18,
    },
    headerSupport: {
      fontSize: 14,
      lineHeight: 20,
    },
    inlineAction: {
      alignSelf: "flex-start",
      marginTop: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: subtle,
    },
    inlineActionText: {
      fontSize: 13,
      fontWeight: "700",
    },
    section: {
      gap: 14,
    },
    sectionHeading: {
      gap: 5,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    sectionSummary: {
      fontSize: 13,
      lineHeight: 18,
    },
    formStack: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
      paddingVertical: 2,
    },
    fieldGroup: {
      gap: 7,
      paddingVertical: 14,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    fieldInput: {
      minHeight: 50,
      borderRadius: 16,
      backgroundColor: inputSurface,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 15,
    },
    fieldInputMultiline: {
      minHeight: 110,
      textAlignVertical: "top",
    },
    fieldInputError: {
      borderWidth: 1,
      borderColor: colors.danger || "#EF4444",
    },
    sectionDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: divider,
    },
    fieldFeedback: {
      fontSize: 12,
      lineHeight: 17,
    },
    twoColumnRow: {
      flexDirection: "row",
      gap: 12,
    },
    twoColumnItem: {
      flex: 1,
    },
    saveRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      paddingTop: 2,
    },
    saveCopy: {
      flex: 1,
      gap: 4,
    },
    saveStateLabel: {
      fontSize: 13,
      fontWeight: "700",
    },
    saveStateMessage: {
      fontSize: 12,
      lineHeight: 17,
    },
    saveButton: {
      minWidth: 132,
      minHeight: 48,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 18,
      backgroundColor: accentBg,
    },
    saveButtonDisabled: {
      opacity: 0.45,
    },
    saveButtonText: {
      color: "#111111",
      fontSize: 14,
      fontWeight: "800",
    },
    groupedList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: divider,
    },
    groupedRow: {
      minHeight: 60,
      paddingHorizontal: 2,
      paddingVertical: 13,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14,
    },
    groupedRowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: divider,
    },
    groupedCopy: {
      flex: 1,
      gap: 4,
    },
    groupedLabel: {
      fontSize: 15,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    groupedMeta: {
      fontSize: 13,
      lineHeight: 18,
    },
    groupedRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexShrink: 0,
    },
    groupedValue: {
      fontSize: 13,
      fontWeight: "600",
    },
    inlineBadge: {
      borderRadius: 999,
      backgroundColor: subtle,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    inlineBadgeText: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    chevron: {
      fontSize: 18,
      lineHeight: 18,
    },
    loadingWrap: {
      minHeight: 180,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    loadingText: {
      fontSize: 13,
      fontWeight: "600",
    },
    errorText: {
      fontSize: 13,
      lineHeight: 19,
    },
    refreshRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      paddingTop: 4,
    },
    refreshHint: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
    },
    refreshLink: {
      fontSize: 13,
      fontWeight: "700",
    },
  });
}
