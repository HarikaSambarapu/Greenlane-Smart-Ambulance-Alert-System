import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCdOcixFzFGDfaguz35VQL1iZkvvOQwJbQ",
  authDomain: "green-lane-f0eda.firebaseapp.com",
  projectId: "green-lane-f0eda",
  storageBucket: "green-lane-f0eda.firebasestorage.app",
  messagingSenderId: "995633183581",
  appId: "1:995633183581:web:cacd329acf2d3c4210c6b4",
  measurementId: "G-DB8KZW3P9S"
};

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);

const auth = getAuth(app);

// ── ADDED ────────────────────────────────────────────────
// Shared helper so every file compares roles the same way.
// Normalizes casing/spacing/hyphens so "driver", "Driver",
// "traffic police", "traffic-police" and "traffic_police" all
// collapse to the same canonical value ("driver" / "traffic_police").
// This makes `data.role === role` checks safe even if a role is
// ever stored slightly differently than expected.
function normalizeRole(value) {
    if (!value) return "";
    return value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

export { db, auth, normalizeRole };