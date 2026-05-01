import { Text, TextInput, View } from "react-native";

export default function ProfileField({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  colors,
  styles,
  error,
  helper,
  multiline,
  autoCapitalize,
  keyboardType,
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={colors.subtextSoft || colors.subtext}
        style={[
          styles.fieldInput,
          multiline && styles.fieldInputMultiline,
          error && styles.fieldInputError,
          { color: colors.text },
        ]}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        selectionColor={colors.accentBg || "#E6FF3B"}
      />
      {!!error ? (
        <Text style={[styles.fieldFeedback, { color: colors.danger || "#EF4444" }]}>
          {error}
        </Text>
      ) : !!helper ? (
        <Text style={[styles.fieldFeedback, { color: colors.subtext }]}>{helper}</Text>
      ) : null}
    </View>
  );
}
