import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

export const TRAINING_WIDGET_SNAPSHOT_KEY = "training_widget_snapshot";

const NativeTrainingWidgetSnapshot = NativeModules?.TrainingWidgetSnapshot || null;

function safeStringify(value) {
  try {
    return JSON.stringify(value || null);
  } catch {
    return null;
  }
}

export async function writeTrainingWidgetSnapshot(snapshot) {
  const json = safeStringify(snapshot);
  if (!json) return false;

  await AsyncStorage.setItem(TRAINING_WIDGET_SNAPSHOT_KEY, json).catch(() => {});

  if (Platform.OS !== "ios" || !NativeTrainingWidgetSnapshot?.writeSnapshot) {
    return false;
  }

  try {
    await NativeTrainingWidgetSnapshot.writeSnapshot(json);
    return true;
  } catch (error) {
    console.warn("[widgets] failed to write native snapshot:", error?.message || error);
    return false;
  }
}

export async function clearTrainingWidgetSnapshot() {
  await AsyncStorage.removeItem(TRAINING_WIDGET_SNAPSHOT_KEY).catch(() => {});

  if (Platform.OS !== "ios" || !NativeTrainingWidgetSnapshot?.clearSnapshot) {
    return false;
  }

  try {
    await NativeTrainingWidgetSnapshot.clearSnapshot();
    return true;
  } catch (error) {
    console.warn("[widgets] failed to clear native snapshot:", error?.message || error);
    return false;
  }
}

export async function readCachedTrainingWidgetSnapshot() {
  const raw = await AsyncStorage.getItem(TRAINING_WIDGET_SNAPSHOT_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
