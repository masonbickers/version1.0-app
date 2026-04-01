import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

export default function GarminAuthReturn() {
  const params = useLocalSearchParams();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>Garmin Return ✅</Text>
      <Text style={{ marginTop: 10 }}>Params:</Text>
      <Text>{JSON.stringify(params, null, 2)}</Text>
    </View>
  );
}
