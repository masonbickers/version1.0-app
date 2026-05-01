import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import ProfileField from "./ProfileField";

export default function ProfileForm({
  values,
  errors,
  colors,
  styles,
  dirty,
  hasErrors,
  saveState,
  saveMessage,
  onChangeField,
  onBlurField,
  onSave,
}) {
  const saving = saveState === "saving";
  const disabled = !dirty || hasErrors || saving;
  const toneColor =
    saveState === "error"
      ? colors.danger || "#EF4444"
      : saveState === "saved"
      ? colors.text
      : colors.subtext;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Identity</Text>
        <Text style={[styles.sectionSummary, { color: colors.subtext }]}>
          Update how you appear across the app.
        </Text>
      </View>

      <View style={styles.formStack}>
        <ProfileField
          label="Name"
          value={values.name}
          onChangeText={(value) => onChangeField("name", value)}
          onBlur={() => onBlurField("name")}
          placeholder="Your name"
          colors={colors}
          styles={styles}
          error={errors.name}
        />

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Username"
          value={values.username}
          onChangeText={(value) => onChangeField("username", value)}
          onBlur={() => onBlurField("username")}
          placeholder="username"
          colors={colors}
          styles={styles}
          error={errors.username}
          helper="Lowercase letters, numbers, dots, and underscores."
          autoCapitalize="none"
        />

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Bio"
          value={values.bio}
          onChangeText={(value) => onChangeField("bio", value)}
          onBlur={() => onBlurField("bio")}
          placeholder="Tell people a bit about you"
          colors={colors}
          styles={styles}
          error={errors.bio}
          helper="Keep it short and personal."
          multiline
        />

        <View style={styles.sectionDivider} />

        <View style={styles.twoColumnRow}>
          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Primary sport"
              value={values.sport}
              onChangeText={(value) => onChangeField("sport", value)}
              onBlur={() => onBlurField("sport")}
              placeholder="Running"
              colors={colors}
              styles={styles}
              error={errors.sport}
            />
          </View>

          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Location"
              value={values.location}
              onChangeText={(value) => onChangeField("location", value)}
              onBlur={() => onBlurField("location")}
              placeholder="London, UK"
              colors={colors}
              styles={styles}
              error={errors.location}
            />
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Website"
          value={values.website}
          onChangeText={(value) => onChangeField("website", value)}
          onBlur={() => onBlurField("website")}
          placeholder="https://"
          colors={colors}
          styles={styles}
          error={errors.website}
          helper="We’ll normalize this to a valid public URL."
          autoCapitalize="none"
          keyboardType="url"
        />
      </View>

      <View style={styles.saveRow}>
        <View style={styles.saveCopy}>
          <Text style={[styles.saveStateLabel, { color: toneColor }]}>
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
              ? "Saving"
              : dirty
              ? "Unsaved changes"
              : "Up to date"}
          </Text>
          {!!saveMessage && (
            <Text style={[styles.saveStateMessage, { color: colors.subtext }]}>
              {saveMessage}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.saveButton,
            disabled && styles.saveButtonDisabled,
          ]}
          activeOpacity={disabled ? 1 : 0.84}
          onPress={onSave}
          disabled={disabled}
        >
          {saving ? (
            <ActivityIndicator color="#111111" />
          ) : (
            <Text style={styles.saveButtonText}>Save profile</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
