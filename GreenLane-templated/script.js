let map;
let ambulanceMarker;       // driver's own marker (driver view only)
let policeMarker;          // this police unit's own marker (police view only)
let policeMarkers = {};    // driver-side only: multiple police markers, keyed by TrafficPolice doc id
let driverMarkers = {};    // police-side only: multiple driver markers, keyed by Drivers doc id (email)
let trackingInterval = null;
let policeTrackingInterval = null;

let alertShown = false;
let policeLat;
let policeLng;

// Used to estimate ambulance speed between consecutive position updates,
// since the browser's geolocation API doesn't give us speed directly
// in a reliable way across all devices.
let lastAmbulancePos = null; // { lat, lng, time }
const ASSUMED_AVG_SPEED_KMH = 40; // fallback used for ETA if speed can't be derived
const DEFAULT_CENTER = [17.6868, 83.2185];
const GEO_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0
};

let driverEmail; // current logged-in driver's email, used as the Ambulance document path
let driverName;  // current logged-in driver's display name, shown to Traffic Police during an emergency
let policeEmail; // current logged-in Traffic Police user's email

// ── NEW FEATURE state ──────────────────────────────────
let driverLat = null;          // driver's own last-known position (for #1)
let driverLng = null;
let emergencyActive = false;   // mirrors liveStatus, used to show/hide #1's confirmation
let lastPoliceDocs = [];       // cached TrafficPolice snapshot, used by #1
let lastDriverDocs = [];       // cached Drivers snapshot, used by the police-side presence map
let policeJunctionName = "";   // this officer's saved junction label, used by #4
let notifVoiceReady = false;   // guards #2 so we don't speak old notifications on page load

import { auth, db, normalizeRole } from "./firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const buzzer = new Audio("alert.mp3");
buzzer.loop = true;

// Mute/unmute for THIS page's buzzer specifically — home.html has its own
// separate <audio> element (homeBuzzer) with its own mute button, since
// they're two independent audio elements on two different pages.
// BUGFIX: mute preference now persists via localStorage under the same
// key home.html uses ("alertSoundMuted") — GreenLane.html and home.html
// are separate full page loads, so without this, navigating between
// pages (or reloading) reset the in-memory mute flag and the siren came
// back even after being explicitly muted.
let mapBuzzerMutedByUser = localStorage.getItem("alertSoundMuted") === "true";

function applyMapBuzzerMuteState() {
    buzzer.muted = mapBuzzerMutedByUser;
    const icon = document.querySelector("#muteMapBuzzerBtn i");
    const text = document.getElementById("muteMapBuzzerText");
    if (mapBuzzerMutedByUser) {
        if (icon) icon.className = "fas fa-volume-mute";
        if (text) text.textContent = "Unmute Alert Sound";
    } else {
        if (icon) icon.className = "fas fa-volume-up";
        if (text) text.textContent = "Mute Alert Sound";
    }
}
applyMapBuzzerMuteState(); // apply the saved preference immediately on page load

function toggleMapBuzzerMute() {
    mapBuzzerMutedByUser = !mapBuzzerMutedByUser;
    localStorage.setItem("alertSoundMuted", mapBuzzerMutedByUser ? "true" : "false");
    applyMapBuzzerMuteState();
    unlockAudioOnce(); // clicking Mute is itself a user gesture - use it to unlock audio, instead of a separate tap-anywhere listener
}
window.toggleMapBuzzerMute = toggleMapBuzzerMute;

// ── AUDIO UNLOCK ──────────────────────────────────
// Mobile browsers (Chrome/Safari) block any audio.play() that
// isn't directly triggered by a user tap/click. Since the buzzer
// needs to play LATER when Firebase detects an active ambulance
// nearby (not from a direct tap), we "unlock" it once, silently,
// the first time the Traffic Police user interacts with the page.
//
// CHANGED: this used to unlock on a tap ANYWHERE on the screen. Per
// request, that's removed - the Mute button's own click (above) is
// what triggers this now, since a real button click is a genuine
// user gesture and there's no longer a separate invisible listener
// covering the whole page.
let audioUnlocked = false;

function unlockAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    buzzer.volume = 0;       // silent unlock — user shouldn't hear this
    buzzer.play()
        .then(() => {
            buzzer.pause();
            buzzer.currentTime = 0;
            buzzer.volume = 1; // restore normal volume for real alerts
            console.log("✅ Buzzer unlocked for this session.");

            // Hide the "tap to enable sound" hint now that it's done its job
            const hint = document.getElementById("soundHint");
            if (hint) hint.style.display = "none";
        })
        .catch(() => {
            // Unlock attempt itself was blocked — will retry on next tap
            audioUnlocked = false;
        });
}

// NOTE: previously there were document-wide "click"/"touchstart"
// listeners here that unlocked audio on a tap anywhere on the
// screen. Those are removed - unlockAudioOnce() is now only called
// from the Mute button's click handler above.

const ambulanceIcon = L.icon({
    iconUrl: "https://cdn-icons-png.flaticon.com/512/2966/2966486.png",
    iconSize: [40, 40]
});

const policeIcon = L.icon({
    iconUrl: "https://cdn-icons-png.flaticon.com/512/1077/1077114.png",
    iconSize: [35, 35]
});

const role = localStorage.getItem("role");
driverEmail = localStorage.getItem("email");
driverName  = localStorage.getItem("name");
policeEmail = localStorage.getItem("email");

// BUGFIX: driverName was only ever read from localStorage, which is
// set once at login and can go stale, be empty, or (for anyone who
// logged in before this feature existed) never have been set at all
// - showing "Unknown Driver" even though the real name is sitting
// right there in Firestore from signup. This fetches the
// authoritative value directly from the users collection instead.
// Uses the stored uid when available (fast, single-document lookup);
// falls back to a one-time email lookup for sessions that logged in
// before uid started being saved, so it works immediately without
// requiring everyone to log out and back in.
async function refreshDriverNameFromFirestore() {
    try {
        const uid = localStorage.getItem("uid");
        let freshName = null;

        if (uid) {
            const userDoc = await getDoc(doc(db, "users", uid));
            if (userDoc.exists()) freshName = userDoc.data().name;
        } else if (driverEmail) {
            const q = query(collection(db, "users"), where("email", "==", driverEmail));
            const results = await getDocs(q);
            if (!results.empty) freshName = results.docs[0].data().name;
        }

        if (freshName) {
            driverName = freshName;
            localStorage.setItem("name", freshName); // keep localStorage in sync too
        }
    } catch (err) {
        console.log("Could not refresh driver name from Firestore:", err);
    }
}
refreshDriverNameFromFirestore();

const welcomeText = document.getElementById("welcomeText");
if (welcomeText) {
    welcomeText.innerText = role === "driver" ? "Welcome Driver 🚑" : "Welcome Traffic Police 👮";
}

window.onload = function () {
    const role = localStorage.getItem("role");
    if (role === "driver") {
        document.getElementById("driverDashboard").classList.add("active");
        initDriverMap();
    } else {
        document.getElementById("policeHome").classList.add("active");
        initPoliceMap();
    }
};

function showScreen(current, next) {
    document.getElementById(current).classList.remove("active");
    document.getElementById(next).classList.add("active");
}

function hasGeolocation() {
    if (!navigator.geolocation) {
        showToast("GPS is not supported on this device/browser", "error");
        return false;
    }
    return true;
}

function getCurrentPositionAsync() {
    return new Promise((resolve, reject) => {
        if (!hasGeolocation()) {
            reject(new Error("Geolocation is not supported"));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    });
}

async function savePoliceLocation(lat, lng) {
    await setDoc(
        doc(db, "TrafficPolice", policeEmail),
        {
            email: policeEmail,
            name: localStorage.getItem("name") || "Traffic Police",
            latitude: lat,
            longitude: lng,
            lastUpdated: serverTimestamp()
        },
        { merge: true }
    );
}
// ─────────────────────────────────────────────────────
//  NEW FEATURE #4 — Named junction instead of raw GPS
//  Lets an officer label their post ("MG Road Signal") so the
//  location means something to a human, not just coordinates.
//  Uses setDoc(..., {merge:true}) so it never overwrites the
//  latitude/longitude the GPS watcher is already saving.
// ─────────────────────────────────────────────────────

async function loadJunctionName() {
    if (!policeEmail) return;
    try {
        const snap = await getDoc(doc(db, "TrafficPolice", policeEmail));
        if (snap.exists() && snap.data().junctionName) {
            policeJunctionName = snap.data().junctionName;
            const input = document.getElementById("junctionNameInput");
            if (input) input.value = policeJunctionName;
        }
    } catch (err) {
        console.log("Could not load saved junction name:", err);
    }
}

async function saveJunctionName() {
    const input = document.getElementById("junctionNameInput");
    if (!input) return;

    const name = input.value.trim();
    policeJunctionName = name;

    try {
        await setDoc(doc(db, "TrafficPolice", policeEmail), {
            junctionName: name,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
        showToast(name ? "Junction name saved: " + name : "Junction name cleared", "success");
    } catch (err) {
        console.log("Could not save junction name:", err);
        showToast("⚠️ Could not save junction name", "error");
    }
}
window.saveJunctionName = saveJunctionName;

async function saveAmbulanceLocation(lat, lng, extra = {}) {
    await setDoc(doc(db, "Ambulance", "ActiveAmbulance"), {
        latitude: lat,
        longitude: lng,
        driverEmail: driverEmail,
        driverName: driverName || "Unknown Driver",
        lastUpdated: new Date().toISOString(),
        ...extra
    }, { merge: true });
}

// ─────────────────────────────────────────────────────
//  NEW FEATURE #1 + BUGFIX — Traffic Police presence
//  BUGFIX: TrafficPolice documents are keyed by email and never
//  get deleted — every account ever used for testing leaves a
//  permanent document with its last-known position. Without a
//  recency check, every one of those old accounts shows up as a
//  marker forever, even though nobody is actually using them
//  anymore. isRecentlyActive() treats an officer as "online" only
//  if their location updated within the last PRESENCE_STALE_MS —
//  paired with the heartbeat in initPoliceMap() below, which keeps
//  a genuinely active (but stationary) officer's timestamp fresh
//  even if their GPS coordinates haven't changed.
//
//  Also consolidates what used to be two separate onSnapshot
//  listeners on the same "TrafficPolice" collection into one.
// ─────────────────────────────────────────────────────

const PRESENCE_STALE_MS = 2 * 60 * 1000; // treat as offline after 2 minutes of no updates

function isRecentlyActive(lastUpdatedIso) {
    if (!lastUpdatedIso) return false;
    const t = new Date(lastUpdatedIso).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) < PRESENCE_STALE_MS;
}

function refreshPoliceNotifiedDisplay() {
    const el = document.getElementById("policeNotifiedCount");
    if (!el) return;

    if (!emergencyActive || driverLat == null || driverLng == null) {
        el.style.display = "none";
        return;
    }

    let count = 0;
    lastPoliceDocs.forEach((d) => {
        if (!isRecentlyActive(d.lastUpdated)) return;
        if (d.latitude == null || d.longitude == null) return;
        if (calculateDistance(driverLat, driverLng, d.latitude, d.longitude) <= 1) count++;
    });

    el.style.display = "flex";
    el.innerHTML = count > 0
        ? '<i class="fas fa-circle-check"></i> ' + count + ' Traffic Police unit' + (count === 1 ? "" : "s") + ' within 1km — notified'
        : '<i class="fas fa-circle-info"></i> No Traffic Police units within 1km yet';
}

function listenForPoliceUnits() {
    onSnapshot(collection(db, "TrafficPolice"), (snapshot) => {
        // Used by refreshPoliceNotifiedDisplay() (feature #1) and by the
        // periodic sweep below — keeps the doc id alongside its data so
        // markers can be matched and removed by id, not just by content.
        lastPoliceDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        refreshPoliceNotifiedDisplay();
        applyPoliceMarkersFromCache();
    });

    // Time-based sweep: an officer can go stale purely because time
    // passed (closed tab, lost connection, laptop slept) — with no new
    // Firestore write to trigger the listener above. Without this,
    // a stale marker would linger until that officer's next unrelated
    // update, which might never come. Re-checks staleness every 30s
    // against the same cached list, independent of Firestore events.
    setInterval(() => {
        refreshPoliceNotifiedDisplay();
        applyPoliceMarkersFromCache();
    }, 30000);
}

function applyPoliceMarkersFromCache() {
    if (!map) return;

    const freshIds = new Set(
        lastPoliceDocs
            .filter((d) => d.latitude != null && d.longitude != null && isRecentlyActive(d.lastUpdated))
            .map((d) => d.id)
    );

    // Remove markers for ids that are no longer fresh (stale or deleted)
    Object.keys(policeMarkers).forEach((id) => {
        if (!freshIds.has(id)) {
            map.removeLayer(policeMarkers[id]);
            delete policeMarkers[id];
        }
    });

    // Add/update markers for every fresh id
    lastPoliceDocs.forEach((d) => {
        if (!freshIds.has(d.id)) return;

        const officerName = d.name || "Traffic Police";
        const label = d.junctionName
            ? "👮 " + d.junctionName + " — " + officerName + " on duty"
            : "👮 " + officerName;

        if (policeMarkers[d.id]) {
            policeMarkers[d.id].setLatLng([d.latitude, d.longitude]);
            policeMarkers[d.id].setTooltipContent(label);
        } else {
            policeMarkers[d.id] = L.marker([d.latitude, d.longitude], { icon: policeIcon })
                .addTo(map)
                .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -12], className: "gl-marker-label" });
        }
    });
}

// ─────────────────────────────────────────────────────
//  NEW FEATURE — Driver presence (mirrors Traffic Police
//  presence above). Every logged-in driver's live location is
//  saved to a "Drivers" collection the moment their map page
//  loads, independent of whether they've tapped Start Emergency.
//  Traffic Police can then see every currently-online driver on
//  their map at all times, the same way drivers already see every
//  currently-online Traffic Police unit. Start Emergency is still
//  what triggers the banner/buzzer/alert - this only controls
//  whether the driver's marker is visible at all, matching "police
//  should see the driver just from being logged in".
// ─────────────────────────────────────────────────────

async function saveDriverPresence(lat, lng) {
    if (!driverEmail) return;
    await setDoc(doc(db, "Drivers", driverEmail), {
        email: driverEmail,
        name: driverName || localStorage.getItem("name") || "Driver",
        latitude: lat,
        longitude: lng,
        lastUpdated: new Date().toISOString()
    }, { merge: true });
}

function listenForDriverUnits() {
    onSnapshot(collection(db, "Drivers"), (snapshot) => {
        lastDriverDocs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        applyDriverMarkersFromCache();
    });

    // Same reasoning as the Traffic Police sweep above: a stationary
    // driver's GPS may not fire a new update for a while, so a timer
    // re-checks staleness independent of Firestore events.
    setInterval(applyDriverMarkersFromCache, 30000);
}

function applyDriverMarkersFromCache() {
    if (!map) return;

    const freshIds = new Set(
        lastDriverDocs
            .filter((d) => d.latitude != null && d.longitude != null && isRecentlyActive(d.lastUpdated))
            .map((d) => d.id)
    );

    Object.keys(driverMarkers).forEach((id) => {
        if (!freshIds.has(id)) {
            map.removeLayer(driverMarkers[id]);
            delete driverMarkers[id];
        }
    });

    lastDriverDocs.forEach((d) => {
        if (!freshIds.has(d.id)) return;

        const label = "🚑 " + (d.name || "Driver");

        if (driverMarkers[d.id]) {
            driverMarkers[d.id].setLatLng([d.latitude, d.longitude]);
            driverMarkers[d.id].setTooltipContent(label);
        } else {
            driverMarkers[d.id] = L.marker([d.latitude, d.longitude], { icon: ambulanceIcon })
                .addTo(map)
                .bindTooltip(label, { permanent: true, direction: "top", offset: [0, -12], className: "gl-marker-label" });
        }
    });
}

// ─────────────────────────────────────────────────────
//  NEW FEATURE #2 — Spoken (text-to-speech) driver alerts
//  Reads Traffic Police status updates out loud so a driver mid-
//  emergency doesn't have to look at the screen to know a junction
//  is clear. Uses the browser's built-in SpeechSynthesis API — no
//  library, no network request, works offline.
// ─────────────────────────────────────────────────────

function speak(text) {
    if (!("speechSynthesis" in window)) {
        console.log("❌ Speech synthesis is not supported.");
        return;
    }

    try {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-IN";
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = () => {
            console.log("🔊 Voice alert started:", text);
        };

        utterance.onend = () => {
            console.log("✅ Voice alert finished.");
        };

        utterance.onerror = (event) => {
            console.error("❌ Voice alert error:", event);
        };

        window.speechSynthesis.speak(utterance);

    } catch (err) {
        console.error("Speech synthesis unavailable:", err);
    }
}

function listenForDriverVoiceAlerts() {
    onSnapshot(collection(db, "Notifications"), (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            if (!notifVoiceReady) return; // skip the existing batch on first load — only speak NEW ones

            const data = change.doc.data();
            if (normalizeRole(data.role) !== "driver") return;

            // Strip emoji so speech doesn't try to read out unicode glyph names
            const clean = (data.message || "").replace(/\p{Extended_Pictographic}/gu, "").trim();
            if (clean) speak(clean);
        });
        notifVoiceReady = true;
    });
}

// ─────────────────────────────────────────────────────
//  DRIVER MAP
// ─────────────────────────────────────────────────────

function initDriverMap() {
    if (map) return;
    map = L.map("driverMap").setView(DEFAULT_CENTER, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap Contributors"
    }).addTo(map);

    listenForDriverVoiceAlerts();
    listenForPoliceUnits(); // BUGFIX #2 — show Traffic Police units on the driver's map (now also handles feature #1's count, and filters out stale/offline officers)

    if (!hasGeolocation()) return;

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            driverLat = lat;
            driverLng = lng;
            map.setView([lat, lng], 15);

            ambulanceMarker = L.marker([lat, lng], { icon: ambulanceIcon })
                .addTo(map)
                .bindPopup("🚑 You (this ambulance)");

            try {
    await saveDriverPresence(lat, lng); // Driver presence only — does NOT start an emergency
} catch (err) {
                console.error("Could not save initial driver GPS:", err);
            }

            refreshPoliceNotifiedDisplay();
            console.log("Driver GPS:", lat, lng);
        },
        (error) => {
            console.error("Driver GPS Error:", error.message);
            showToast("⚠️ GPS access required for tracking", "error");
        },
        GEO_OPTIONS
    );

    // Heartbeat: keeps this driver's presence fresh for Traffic Police
    // even while stationary, the same reasoning as the Traffic Police
    // heartbeat in initPoliceMap() below.
    setInterval(() => {
        if (driverLat != null && driverLng != null) {
            saveDriverPresence(driverLat, driverLng).catch((err) =>
                console.log("Driver presence heartbeat failed:", err)
            );
        }
    }, 45000);
}

// ─────────────────────────────────────────────────────
//  TRAFFIC POLICE MAP
// ─────────────────────────────────────────────────────

function initPoliceMap() {
    console.log("Initialising Traffic Police map...");
    if (map) return;

    loadJunctionName(); // NEW FEATURE #4 — prefill any previously saved junction label

    map = L.map("publicMap").setView(DEFAULT_CENTER, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap Contributors"
    }).addTo(map);

    console.log("Map ready. Getting Traffic Police unit GPS...");

    listenForDriverUnits(); // NEW - show every currently-logged-in driver on the map, independent of Start Emergency
    // Use the last known Traffic Police location immediately
try {
    const savedLocation = JSON.parse(
        localStorage.getItem("policeLastLocation")
    );

    if (
        savedLocation &&
        savedLocation.lat != null &&
        savedLocation.lng != null
    ) {
        policeLat = savedLocation.lat;
        policeLng = savedLocation.lng;

        console.log(
            "📍 Using saved Traffic Police location:",
            policeLat,
            policeLng
        );

        policeMarker = L.circleMarker(
            [policeLat, policeLng],
            {
                radius: 10,
                color: "#2563eb",
                fillColor: "#2563eb",
                fillOpacity: 1
            }
        ).addTo(map);

        policeMarker.bindPopup("👮 Your junction position");

        map.flyTo(
            [policeLat, policeLng],
            16
        );

        checkActiveAmbulanceAlert();
    }
} catch (err) {
    console.log("Could not restore saved police location:", err);
}
    if (!hasGeolocation()) {
        listenForAmbulance();
        return;
    }

    policeTrackingInterval = navigator.geolocation.watchPosition(
        async (position) => {
            policeLat = position.coords.latitude;
            policeLng = position.coords.longitude;

            console.log("Saving Traffic Police location:", policeEmail, policeLat, policeLng);

            try {
                await savePoliceLocation(policeLat, policeLng);
                console.log("Traffic Police location saved to Firebase.");
            } catch (err) {
                console.error("Failed to save Traffic Police location:", err);
            }

            if (policeMarker) {
                policeMarker.setLatLng([policeLat, policeLng]);
            } else {
                policeMarker = L.circleMarker([policeLat, policeLng], {
                    radius: 10,
                    color: "#2563eb",
                    fillColor: "#2563eb",
                    fillOpacity: 1
                }).addTo(map);

                policeMarker.bindPopup("👮 Your junction position");
                map.flyTo([policeLat, policeLng], 16);
            }
            checkActiveAmbulanceAlert();
        },
        (error) => {
            console.error("GPS Error:", error.message);
            showToast("⚠️ GPS access required", "error");
        },
        GEO_OPTIONS
    );

    // Heartbeat: watchPosition only fires on movement in some browsers,
    // so a genuinely active officer standing still could go quiet long
    // enough to look "stale" and disappear from the driver's map (see
    // PRESENCE_STALE_MS above). Re-saving on a timer, independent of
    // actual GPS movement, keeps lastUpdated fresh the whole time this
    // officer's tab is open.
    setInterval(() => {
        if (policeLat != null && policeLng != null) {
            savePoliceLocation(policeLat, policeLng).catch((err) =>
                console.log("Heartbeat location save failed:", err)
            );
        }
    }, 45000);

    listenForAmbulance();
}

function triggerEmergencyAlert() {
    const popup = document.getElementById("alertPopup");
    if (popup) {
        popup.style.display = "block";
        setTimeout(() => { popup.style.display = "none"; }, 5000);
    }
}
async function checkActiveAmbulanceAlert() {
    if (policeLat == null || policeLng == null) {
        return;
    }

    try {
        const snapshot = await getDoc(
            doc(db, "Ambulance", "ActiveAmbulance")
        );

        if (!snapshot.exists()) {
            return;
        }

        const data = snapshot.data();

        if (data.status !== "active") {
            return;
        }

        if (data.latitude == null || data.longitude == null) {
            return;
        }

        const distanceKm = calculateDistance(
            data.latitude,
            data.longitude,
            policeLat,
            policeLng
        );

        console.log(
            "🔄 Rechecking active ambulance:",
            distanceKm.toFixed(2),
            "km"
        );

        const banner = document.getElementById("emergencyBanner");

        if (banner && distanceKm <= 1) {
            banner.style.display = "block";

            const etaSeconds = Math.round(
                (distanceKm / ASSUMED_AVG_SPEED_KMH) * 3600
            );

            const etaText =
                etaSeconds < 60
                    ? etaSeconds + " sec"
                    : Math.round(etaSeconds / 60) + " min";

            if (!alertShown) {
                alertShown = true;

                saveNotification(
                    "🚑 Emergency Alert – Ambulance approaching your junction (" +
                    Math.round(distanceKm * 1000) +
                    "m, ETA " +
                    etaText +
                    ")"
                );

                triggerEmergencyAlert();
            }

            if (!mapBuzzerMutedByUser && buzzer.paused) {
                buzzer.play().catch((e) =>
                    console.log("Buzzer playback blocked:", e)
                );
            }
        }
    } catch (err) {
        console.error(
            "Could not recheck active ambulance:",
            err
        );
    }
}

/**
 * Listens to the single active ambulance document and updates:
 *  1. The ambulance marker on the Traffic Police map
 *  2. Distance from this Traffic Police unit to the ambulance
 *  3. An estimated speed (derived from consecutive GPS updates) and ETA
 *  4. The emergency banner / popup / buzzer when the ambulance is close
 */
   function listenForAmbulance() {
    onSnapshot(doc(db, "Ambulance", "ActiveAmbulance"), (snapshot) => {

        const ambStatusEl   = document.getElementById("ambStatus");
        const ambDriverEl   = document.getElementById("ambDriverName");
        const ambDistanceEl = document.getElementById("ambDistance");
        const ambETAEl      = document.getElementById("ambETA");
        const ambSpeedEl    = document.getElementById("ambSpeed");
        const ambDirectionEl = document.getElementById("ambDirection"); // NEW FEATURE #5

        if (!snapshot.exists()) {
            if (ambStatusEl) { ambStatusEl.textContent = "Inactive"; ambStatusEl.style.color = "var(--text-muted)"; }
            return;
        }

        const data = snapshot.data();
        const isActive = data.status === "active";

        // NOTE: marker drawing used to live here, gated to isActive
        // only. It's been moved out - the new driver presence system
        // below (listenForDriverUnits/applyDriverMarkersFromCache)
        // now shows every currently-logged-in driver's marker on this
        // map regardless of emergency status, the same way police
        // units already show up on the driver's map. This function
        // stays focused on the info panel, banner, and buzzer for
        // whichever driver currently has an active emergency.

        // Status
        if (ambStatusEl) {
            ambStatusEl.textContent = isActive ? "Active 🔴" : "Inactive";
            ambStatusEl.style.color = isActive ? "var(--emergency)" : "var(--text-muted)";
        }

        // BUGFIX: name, email, speed, distance, ETA, and direction used
        // to populate as soon as any driver was logged in, since this
        // document gets written on every driver map load, not only on
        // Start Emergency. Per request, these details should only be
        // visible to Traffic Police once an emergency is actually
        // active - the driver still shows as a marker on the map either
        // way (that's the separate presence system above), but these
        // specifics stay hidden until there's a real emergency.
        if (!isActive) {
            if (ambDriverEl)    ambDriverEl.textContent = "–";
            if (ambSpeedEl)     ambSpeedEl.textContent = "– km/h";
            if (ambDistanceEl)  ambDistanceEl.textContent = "– km";
            if (ambDirectionEl) ambDirectionEl.textContent = "–";
            if (ambETAEl)       ambETAEl.textContent = "–";

            // Make sure the banner/buzzer clear immediately when an
            // emergency ends, rather than only clearing further down
            // in the distance-dependent code below (which we're about
            // to skip via the early return).
            const banner = document.getElementById("emergencyBanner");
            if (banner) banner.style.display = "none";
            alertShown = false;
            buzzer.pause();
            buzzer.currentTime = 0;

            return;
        }

        // Driver name / ambulance ID
        if (ambDriverEl) {
            const name = data.driverName || "Unknown Driver";
            const email = data.driverEmail || "";
            ambDriverEl.textContent = email ? name + " (" + email + ")" : name;
        }

        // Estimate speed from consecutive GPS updates (km/h)
        let estimatedSpeedKmh = null;
        if (data.latitude != null && data.longitude != null) {
            const now = Date.now();
            if (lastAmbulancePos) {
                const distKm = calculateDistance(
                    lastAmbulancePos.lat, lastAmbulancePos.lng,
                    data.latitude, data.longitude
                );
                const hoursElapsed = (now - lastAmbulancePos.time) / 1000 / 3600;
                if (hoursElapsed > 0) {
                    const speed = distKm / hoursElapsed;
                    // Ignore wildly unrealistic spikes (GPS jitter) — keep it sane for a demo
                    if (speed >= 0 && speed < 150) estimatedSpeedKmh = speed;
                }
            }
            lastAmbulancePos = { lat: data.latitude, lng: data.longitude, time: now };
        }

        if (ambSpeedEl) {
            ambSpeedEl.textContent = estimatedSpeedKmh != null
                ? estimatedSpeedKmh.toFixed(0) + " km/h"
                : "– km/h";
        }

// Distance + ETA relative to this Traffic Police unit
if (
    policeLat == null ||
    policeLng == null ||
    data.latitude == null ||
    data.longitude == null
) {
    return;
}
        const distanceKm = calculateDistance(data.latitude, data.longitude, policeLat, policeLng);

        if (ambDistanceEl) ambDistanceEl.textContent = distanceKm.toFixed(2) + " km";

        // NEW FEATURE #5 — which way to look, not just how far
        if (ambDirectionEl) {
            const bearing = calculateBearing(policeLat, policeLng, data.latitude, data.longitude);
            ambDirectionEl.textContent = bearingToCompass(bearing);
        }

        const speedForETA = (estimatedSpeedKmh && estimatedSpeedKmh > 5) ? estimatedSpeedKmh : ASSUMED_AVG_SPEED_KMH;
        const etaSeconds = Math.round((distanceKm / speedForETA) * 3600);
        const etaText = etaSeconds < 60 ? etaSeconds + " sec" : Math.round(etaSeconds / 60) + " min";

        if (ambETAEl) ambETAEl.textContent = etaText;

        try { localStorage.setItem("nearestDistance", distanceKm.toFixed(2)); } catch (e) {}

        // Emergency banner / popup / buzzer
        const banner = document.getElementById("emergencyBanner");
        if (banner) {
            if (isActive && distanceKm <= 1) {
                banner.style.display = "block";
                if (!alertShown) {
    alertShown = true;

    saveNotification(
        "🚑 Emergency Alert – Ambulance approaching your junction (" +
        Math.round(distanceKm * 1000) + "m, ETA " + etaText + ")"
    );

    triggerEmergencyAlert();
}

// Keep the buzzer active while the emergency is active.
// It can only be silenced using the Mute button.
if (!mapBuzzerMutedByUser && buzzer.paused) {
    buzzer.play().catch(e =>
        console.log("Buzzer playback blocked:", e)
    );
}
            } else {
                banner.style.display = "none";
                alertShown = false;
                buzzer.pause();
                buzzer.currentTime = 0;
            }
        }
    });
   }

// ─────────────────────────────────────────────────────
//  TRAFFIC POLICE JUNCTION ACTIONS (map page version)
// ─────────────────────────────────────────────────────

async function setJunctionStatusMap(status) {
    const badge = document.getElementById("policeStatusBadgeMap");
    const text  = document.getElementById("junctionStatusTextMap");
    if (badge && text) {
        badge.style.display = "block";
        text.textContent = status;
    }

    try {
        await setDoc(doc(db, "TrafficPolice", policeEmail), {
            junctionStatus: status,
            lastUpdated: new Date().toISOString()
        }, { merge: true });
    } catch (err) {
        console.log("Could not update junction status in Firebase:", err);
    }

    // NEW FEATURE #4 — include the junction name (if the officer set one)
    // so the driver hears/reads something meaningful, not just a status
    await addDoc(collection(db,"Notifications"),{
    role:"driver",
    message:"👮 " + (policeJunctionName ? policeJunctionName + ": " : "") + status,
    time:serverTimestamp()
});

    showToast("Status updated: " + status, "info");
}
window.setJunctionStatusMap = setJunctionStatusMap;

// ─────────────────────────────────────────────────────
//  EMERGENCY START / STOP (Driver)
// ─────────────────────────────────────────────────────

async function startEmergency() {
    // NEW FEATURE: confirmation guard — starting an emergency triggers
    // buzzers/banners on every Traffic Police device watching this
    // document, so a single accidental tap shouldn't be able to do
    // that. A plain confirm() is enough here; it doesn't touch GPS,
    // Firestore, or anything else in this function.
    if (!confirm("Start an emergency alert? Traffic Police nearby will be notified immediately.")) {
        return;
    }

    try {
        const position = await getCurrentPositionAsync();
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        if (ambulanceMarker) {
            ambulanceMarker.setLatLng([lat, lng]);
            map.setView([lat, lng], 15);
        }

        await saveAmbulanceLocation(lat, lng, { status: "active" });

        // NEW FEATURE — log this emergency start (location + real
        // timestamp) so Traffic Police can see "how many ambulances
        // started an emergency near my junction today". A permanent,
        // append-only log - unlike the singleton Ambulance document,
        // this is never overwritten, so history isn't lost.
        try {
            await addDoc(collection(db, "EmergencyLog"), {
                driverEmail: driverEmail,
                driverName: driverName || "Unknown Driver",
                latitude: lat,
                longitude: lng,
                startedAt: serverTimestamp()
            });
        } catch (err) {
            console.log("Could not log emergency start:", err);
        }
    } catch (err) {
        console.error("Could not get fresh driver GPS:", err);
        showToast("⚠️ Allow GPS before starting emergency", "error");
        return;
    }

    await addDoc(collection(db,"Notifications"),{
    role:"traffic_police",
    message:"🚑 Emergency Started",
    time:serverTimestamp()
});

    document.getElementById("liveStatus").innerText = "Emergency Active";
    document.getElementById("liveStatus").classList.add("active-status");
    triggerEmergencyAlert();
    startTracking();
    showToast("🚑 Emergency Started", "success");

    emergencyActive = true;
    refreshPoliceNotifiedDisplay(); // NEW FEATURE #1 — show confirmation right away
   // addNotification("Emergency Started")
}

async function stopEmergency() {
    const ambulanceRef = doc(db, "Ambulance", "ActiveAmbulance");
    await updateDoc(ambulanceRef, { status: "inactive" });

    await addDoc(collection(db,"Notifications"),{
    role:"traffic_police",
    message:"🚑 Emergency Ended",
    time:serverTimestamp()
});

    buzzer.pause();
    buzzer.currentTime = 0;
    if (trackingInterval != null) {
        navigator.geolocation.clearWatch(trackingInterval);
        trackingInterval = null;
    }

    document.getElementById("liveStatus").innerText = "Emergency Ended";
    document.getElementById("liveStatus").classList.remove("active-status");
    saveNotification("🚑 Emergency Ended");
    showToast("⛔ Emergency Stopped", "info");

    emergencyActive = false;
    refreshPoliceNotifiedDisplay(); // NEW FEATURE #1 — hide the confirmation
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────
//  NEW FEATURE #5 — Compass direction to the ambulance
//  Distance alone doesn't tell an officer which way to look.
//  This computes the bearing FROM this Traffic Police unit
//  TO the ambulance, then converts it to a compass label.
// ─────────────────────────────────────────────────────

function calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
}

function bearingToCompass(bearing) {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return directions[Math.round(bearing / 45) % 8];
}

function startTracking() {
    if (trackingInterval != null) return;
    if (!hasGeolocation()) return;

    trackingInterval = navigator.geolocation.watchPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            driverLat = lat;
            driverLng = lng;
            console.log("Driver GPS:", lat, lng);
            if (ambulanceMarker) ambulanceMarker.setLatLng([lat, lng]);
            await saveAmbulanceLocation(lat, lng, { status: "active" });
            refreshPoliceNotifiedDisplay();
        },
        (error) => {
            console.error("GPS Error:", error);
            showToast("⚠️ GPS tracking interrupted", "error");
        },
        GEO_OPTIONS
    );
}

// ─────────────────────────────────────────────────────
//  NOTIFICATION SYSTEM
// ─────────────────────────────────────────────────────

function saveNotification(message) {
    const notifications = JSON.parse(localStorage.getItem("notifications")) || [];
    notifications.push({
        text: message,
        time: new Date().toISOString()
    });
    localStorage.setItem("notifications", JSON.stringify(notifications));
    updateInPageList(message);
}

function updateInPageList(message) {
    const list = document.getElementById("notificationList");
    if (!list) return;
    const li = document.createElement("li");
    li.style.cssText = "padding:6px 0; border-bottom:1px solid #eee; font-size:13px;";
    li.innerText = new Date().toLocaleTimeString() + " – " + message;
    list.prepend(li);
}

// ─────────────────────────────────────────────────────
//  TOAST HELPER
// ─────────────────────────────────────────────────────

function showToast(message, type = "info") {
    const old = document.getElementById("gl-toast");
    if (old) old.remove();

    const colors = {
        success: "#27ae60",
        error:   "#e74c3c",
        info:    "#2980b9"
    };

    const toast = document.createElement("div");
    toast.id = "gl-toast";
    toast.innerText = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 24px;
        border-radius: 30px;
        font-size: 14px;
        font-weight: 600;
        z-index: 9999;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        animation: fadeInUp 0.3s ease;
    `;

    if (!document.getElementById("toast-style")) {
        const s = document.createElement("style");
        s.id = "toast-style";
        s.innerText = `@keyframes fadeInUp {
            from { opacity:0; transform:translateX(-50%) translateY(10px); }
            to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }`;
        document.head.appendChild(s);
    }

    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
}

// ─────────────────────────────────────────────────────
//  LOGOUT / HOME NAVIGATION
// ─────────────────────────────────────────────────────

async function logout() {
    try {
        await signOut(auth);
        localStorage.clear();
        window.location.replace("login.html");
    } catch (error) {
        console.error("Logout failed:", error);
        alert("Logout failed. Please try again.");
    }
}

window.logout = logout;

function goHome() {

    buzzer.pause();
    buzzer.currentTime = 0;
    stopLocationWatches();

    window.location.href = "home.html";
}
window.startEmergency = startEmergency;
window.stopEmergency  = stopEmergency;
window.goHome         = goHome;
window.logout         = logout;

// SAFETY NET: stop the buzzer no matter HOW the user leaves this page —
// clicking Home, browser back button, closing the tab, or refreshing.
window.addEventListener("pagehide", () => {
    buzzer.pause();
    buzzer.currentTime = 0;
    stopLocationWatches();
});

function stopLocationWatches() {
    if (trackingInterval != null) {
        navigator.geolocation.clearWatch(trackingInterval);
        trackingInterval = null;
    }

    if (policeTrackingInterval != null) {
        navigator.geolocation.clearWatch(policeTrackingInterval);
        policeTrackingInterval = null;
    }
}