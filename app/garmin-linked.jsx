import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

export default function GarminLinked() {
  const params = useLocalSearchParams();

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>Garmin Linked ✅</Text>
      <Text style={{ marginTop: 12 }}>{JSON.stringify(params, null, 2)}</Text>
    </View>
  );
}
