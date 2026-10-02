// push-notifications.js
//
// ── ADDED FOR ANDROID CONVERSION ─────────────────────────────────────
// Registers this device for Firebase Cloud Messaging so a Traffic
// Police officer can be alerted even when the Android app is
// backgrounded or fully closed.
//
// This file is a complete no-op in two cases, by design:
//   1. Loaded in a normal web browser (not the native Android app) -
//      window.Capacitor.isNativePlatform() is false/undefined there,
//      so the existing Firebase-Hosting website is unaffected.
//   2. Loaded for a "driver" account - only Traffic Police need to
//      register for push.
//
// It writes exactly ONE new, optional field - fcmToken - onto the
// SAME TrafficPolice/{policeEmail} document script.js already
// maintains (latitude, longitude, junctionName, junctionStatus,
// lastUpdated), using the same setDoc(..., { merge: true }) pattern
// already used there. Nothing existing on that document is renamed,
// removed, or restructured.
//
// It relies on the global `Capacitor.Plugins.PushNotifications` object
// that Capacitor's native Android runtime injects automatically once
// @capacitor/push-notifications is installed and `npx cap sync` has
// been run. No bundler/import is needed for the plugin itself, so
// this project's existing "plain <script>, no build step" setup is
// left intact.

import { db } from "./firebase.js";
import {
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

(async function initPushNotifications() {
  const Capacitor = window.Capacitor;

  // Case 1: not running inside the native Android app - do nothing.
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) {
    return;
  }

  const role = localStorage.getItem("role");
  const normalizedRole = (role || "").toString().trim().toLowerCase().replace(/[\s-]+/g, "_");

  // Case 2: not a Traffic Police account - do nothing.
  if (normalizedRole !== "traffic_police") {
    return;
  }

  const policeEmail = localStorage.getItem("email");
  if (!policeEmail) return;

  const PushNotifications = Capacitor.Plugins && Capacitor.Plugins.PushNotifications;
  if (!PushNotifications) {
    console.log("PushNotifications plugin not available on this build.");
    return;
  }

  try {
    // Android 13+ requires this runtime permission (POST_NOTIFICATIONS).
    // On older Android versions this resolves as already granted.
    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== "granted") {
      permStatus = await PushNotifications.requestPermissions();
    }
    if (permStatus.receive !== "granted") {
      console.log("Push notification permission not granted.");
      return;
    }

    // Custom channel so the FCM push uses the same buzzer sound as the
    // existing in-app alert. "sound: 'alert'" maps to the native
    // resource android/app/src/main/res/raw/alert.mp3 - see STEP D.
    // Creating a channel that already exists is a safe no-op.
    await PushNotifications.createChannel({
      id: "greenlane_emergency",
      name: "Greenline Emergency Alerts",
      description: "Ambulance emergency alerts near your junction",
      importance: 5, // IMPORTANCE_HIGH - heads-up notification + sound
      sound: "alert",
      visibility: 1
    });

    await PushNotifications.register();

    PushNotifications.addListener("registration", async (token) => {
      try {
        await setDoc(
          doc(db, "TrafficPolice", policeEmail),
          {
            fcmToken: token.value,
            fcmTokenUpdated: new Date().toISOString()
          },
          { merge: true }
        );
        console.log("FCM token saved for", policeEmail);
      } catch (err) {
        console.log("Could not save FCM token:", err);
      }
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.log("Push registration error:", err);
    });
  } catch (err) {
    console.log("Push notification setup failed:", err);
  }
})();
