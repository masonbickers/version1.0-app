// app/index.jsx
import { Redirect } from "expo-router";
import { useAuth } from "../providers/AuthProvider"; // 👈 ./ not ../

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) return null;

  return <Redirect href={user ? "/(protected)/home" : "/(auth)/login"} />;
}
