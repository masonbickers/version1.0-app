import { auth } from "../../../firebaseConfig";

export async function getAuthTokenOrThrow() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not signed in.");
  }
  return user.getIdToken();
}

export async function getJsonAuthHeaders(extra = {}) {
  const token = await getAuthTokenOrThrow();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

