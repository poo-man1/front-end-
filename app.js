
// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
// NOTE: Keeping your existing server to avoid breaking connections.
// If you've renamed the backend, update the URL below once.
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO Connection =====
const socket = io(SERVER_URL, {
  transports: ["websocket"]
});

const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

let pc = null;
let localStream = null;
let micOn = true;
let camOn = true;

// ICE config (STUN only for now – TURN optional)
const iceConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ==============================
   1️⃣ GET CAMERA FIRST (FIX)
================================ */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;
    localVideo.muted = true; // 🔴 VERY IMPORTANT (prevents echo)
  } catch (err) {
    alert(`Camera or mic permission denied on ${APP_NAME}`);
    console.error(err);
  }
}

initMedia();

/* ==============================
   2️⃣ CREATE PEER CONNECTION
================================ */
function createPeerConnection() {
  pc = new RTCPeerConnection(iceConfig);

  // Add local tracks ONLY after stream exists
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", event.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      resetConnection();
    }
  };
}

/* ==============================
   3️⃣ SOCKET EVENTS
================================ */
socket.on("matched", async ({ initiator }) => {
  createPeerConnection();

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", offer);
  }
});

socket.on("signal", async (data) => {
  if (!pc) createPeerConnection();

  if (data.type === "offer") {
    await pc.setRemoteDescription(data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", answer);
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(data);
  } else {
    await pc.addIceCandidate(data);
  }
});

socket.on("chat", (msg) => {
  messages.innerHTML += `<div>Stranger: ${escapeHtml(msg)}</div>`;
  scrollMessagesToBottom();
});

socket.on("peer-disconnected", resetConnection);
socket.on("reported", () => alert(`You were reported on ${APP_NAME}`));
socket.on("banned", () => alert(`You are temporarily banned from ${APP_NAME}`));

/* ==============================
   4️⃣ CONTROLS
================================ */
function send() {
  const input = document.getElementById("text");
  if (!input.value) return;

  messages.innerHTML += `<div>You: ${escapeHtml(input.value)}</div>`;
  socket.emit("chat", input.value);
  input.value = "";
  scrollMessagesToBottom();
}

function toggleMic() {
  micOn = !micOn;
  const tracks = localStream.getAudioTracks();
  if (tracks[0]) tracks[0].enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  const tracks = localStream.getVideoTracks();
  if (tracks[0]) tracks[0].enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) {
    socket.emit("report");
    showStatus("Reported. Finding a new match…");
    resetConnection();
  }
}

function next() {
  showStatus("Connecting to the next match…");
  resetConnection();
}

/* ==============================
   5️⃣ RESET (SAFE)
================================ */
function resetConnection() {
  try {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pc = null;
    }
  } catch (e) {
    console.warn("Peer close error", e);
  }

  // Reconnect to server fresh for a new match
  remoteVideo.srcobject = null;
}

/* ==============================
   6️⃣ Small Helpers
================================ */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scrollMessagesToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function showStatus(text) {
  // Quick transient banner above controls
  const id = "omingle-status";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.bottom = "50px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "rgba(0,0,0,0.7)";
    el.style.color = "#fff";
    el.style.padding = "8px 12px";
    el.style.borderRadius = "6px";
    el.style.fontSize = "14px";
    el.style.zIndex = "1000";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 1800);
}
