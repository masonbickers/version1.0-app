import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

import ProfileField from "./ProfileField";

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
  const estimatedMaxHR = estimateMaxHrFromAge(ageFromDob(values.dobISO));
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

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.subtext }]}>Training profile</Text>
        <Text style={[styles.sectionSummary, { color: colors.subtext }]}>
          Private details used to personalise training analysis, heart-rate zones, and AI feedback.
        </Text>
      </View>

      <View style={styles.formStack}>
        <View style={styles.twoColumnRow}>
          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Date of birth"
              value={values.dobISO}
              onChangeText={(value) => onChangeField("dobISO", value)}
              onBlur={() => onBlurField("dobISO")}
              placeholder="YYYY-MM-DD"
              colors={colors}
              styles={styles}
              error={errors.dobISO}
              helper="Used to estimate age-based training ranges."
              keyboardType="numbers-and-punctuation"
            />
          </View>

          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Sex"
              value={values.sex}
              onChangeText={(value) => onChangeField("sex", value)}
              onBlur={() => onBlurField("sex")}
              placeholder="Optional"
              colors={colors}
              styles={styles}
              error={errors.sex}
              helper="Optional context for personalised analysis."
            />
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <View style={styles.twoColumnRow}>
          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Height"
              value={values.heightCm}
              onChangeText={(value) => onChangeField("heightCm", value)}
              onBlur={() => onBlurField("heightCm")}
              placeholder="cm"
              colors={colors}
              styles={styles}
              error={errors.heightCm}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Weight"
              value={values.weightKg}
              onChangeText={(value) => onChangeField("weightKg", value)}
              onBlur={() => onBlurField("weightKg")}
              placeholder="kg"
              colors={colors}
              styles={styles}
              error={errors.weightKg}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <View style={styles.twoColumnRow}>
          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Max HR"
              value={values.maxHR}
              onChangeText={(value) => onChangeField("maxHR", value)}
              onBlur={() => onBlurField("maxHR")}
              placeholder="bpm"
              colors={colors}
              styles={styles}
              error={errors.maxHR}
              helper={
                estimatedMaxHR
                  ? `Leave blank to use age estimate: ${estimatedMaxHR} bpm.`
                  : "Leave blank if unknown."
              }
              keyboardType="number-pad"
            />
          </View>

          <View style={styles.twoColumnItem}>
            <ProfileField
              label="Resting HR"
              value={values.restingHR}
              onChangeText={(value) => onChangeField("restingHR", value)}
              onBlur={() => onBlurField("restingHR")}
              placeholder="bpm"
              colors={colors}
              styles={styles}
              error={errors.restingHR}
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Threshold HR"
          value={values.thresholdHR}
          onChangeText={(value) => onChangeField("thresholdHR", value)}
          onBlur={() => onBlurField("thresholdHR")}
          placeholder="bpm"
          colors={colors}
          styles={styles}
          error={errors.thresholdHR}
          helper="Optional. Useful if you know your lactate threshold HR."
          keyboardType="number-pad"
        />

        <View style={styles.sectionDivider} />

        <ProfileField
          label="Training context"
          value={values.trainingBackground}
          onChangeText={(value) => onChangeField("trainingBackground", value)}
          onBlur={() => onBlurField("trainingBackground")}
          placeholder="Recent injuries, goals, experience, limits, or anything the coach should know"
          colors={colors}
          styles={styles}
          error={errors.trainingBackground}
          helper="Private notes for better AI analysis."
          multiline
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
