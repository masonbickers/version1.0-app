// firebaseConfig.js — web + native auth persistence for Expo

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// --- Your Firebase project ---
const firebaseConfig = {
  apiKey: "AIzaSyCo8g6QFxnqISn8wMqdg43WDG3OuUEbWEo",
  authDomain: "be-app-5cdd1.firebaseapp.com",
  projectId: "be-app-5cdd1",
  storageBucket: "be-app-5cdd1.firebasestorage.app",
  messagingSenderId: "277867142631",
  appId: "1:277867142631:web:77691f46f9ab7e7ed03142",
  measurementId: "G-V371M5P72Y",
};

// --- Init app ---
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// --- Auth with persistence ---
let auth;

if (Platform.OS === "web") {
  // 🌐 Web: browser localStorage
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn("Failed to set web auth persistence:", err?.message || err);
  });
} else {
  // 📱 Native (iOS / Android): AsyncStorage
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (e) {
    // If initializeAuth was already called (e.g. fast refresh), reuse existing
    auth = getAuth(app);
  }
}

// --- Single sources of truth ---
export const db = getFirestore(app);
export const storage = getStorage(app);
export { auth };
