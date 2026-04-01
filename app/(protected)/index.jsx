import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import { Text, TouchableOpacity, View } from "react-native";
import { auth } from "../../firebaseConfig";

export default function ProtectedHome() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700" }}>You’re logged in ✅</Text>
      <TouchableOpacity onPress={async () => { await signOut(auth); router.replace("/(auth)/login"); }}>
        <Text style={{ color: "#2563eb", fontWeight: "600" }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}
