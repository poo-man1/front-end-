// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO Connection =====
const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"] // ✅ polling as fallback
});

const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

let pc = null;
let localStream = null;
let micOn = true;
let camOn = true;

// ✅ ICE candidate queue — fixes race condition
let iceCandidateQueue = [];
let remoteDescSet = false;

// ✅ Multiple STUN + FREE TURN servers
const iceConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    // ✅ Free TURN from Open Relay Project (works globally including India)
    {
      urls: "turn:openrelayproject.org:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelayproject.org:80?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
  iceCandidatePoolSize: 10 // ✅ pre-gather candidates for faster connection
};

/* ==============================
   1️⃣ GET CAMERA FIRST
================================ */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
    localVideo.muted = true;
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
  // Clean up existing
  if (pc) {
    pc.close();
    pc = null;
  }

  iceCandidateQueue = [];
  remoteDescSet = false;

  pc = new RTCPeerConnection(iceConfig);

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { type: "candidate", candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
    if (pc.connectionState === "connected") {
      showStatus("✅ Connected!");
    } else if (pc.connectionState === "failed") {
      showStatus("❌ Connection failed. Try next.");
    } else if (pc.connectionState === "disconnected") {
      showStatus("⚠️ Peer disconnected.");
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", pc.iceConnectionState);
  };
}

/* ==============================
   ✅ DRAIN ICE QUEUE (Race fix)
================================ */
async function drainIceCandidateQueue() {
  while (iceCandidateQueue.length > 0) {
    const candidate = iceCandidateQueue.shift();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn("ICE candidate error:", e);
    }
  }
}

/* ==============================
   3️⃣ SOCKET EVENTS
================================ */
socket.on("waiting", () => {
  showStatus("⏳ Waiting for a match...");
});

socket.on("matched", async ({ initiator }) => {
  showStatus("🎉 Matched! Connecting...");
  createPeerConnection();

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", offer);
  }
});

socket.on("signal", async (data) => {
  if (!pc) createPeerConnection();

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      remoteDescSet = true;
      await drainIceCandidateQueue(); // ✅ flush queued candidates
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", answer);

    } else if (data.type === "answer") {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      remoteDescSet = true;
      await drainIceCandidateQueue(); // ✅ flush queued candidates

    } else if (data.type === "candidate" || data.candidate) {
      // ✅ Queue if remote description not set yet
      const candidate = data.candidate || data;
      if (remoteDescSet) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceCandidateQueue.push(candidate);
      }
    }
  } catch (e) {
    console.error("Signal handling error:", e);
  }
});

socket.on("chat", (msg) => {
  messages.innerHTML += `<div><b>Stranger:</b> ${escapeHtml(msg)}</div>`;
  scrollMessagesToBottom();
});

socket.on("peer-disconnected", () => {
  showStatus("👋 Stranger disconnected.");
  cleanupPeer();
  remoteVideo.srcObject = null;
});

socket.on("reported", () => alert(`You were reported on ${APP_NAME}`));
socket.on("banned", () => {
  alert(`You are temporarily banned from ${APP_NAME}`);
  socket.disconnect();
});

/* ==============================
   4️⃣ CONTROLS
================================ */
function send() {
  const input = document.getElementById("text");
  if (!input.value.trim()) return;
  messages.innerHTML += `<div><b>You:</b> ${escapeHtml(input.value)}</div>`;
  socket.emit("chat", input.value);
  input.value = "";
  scrollMessagesToBottom();
}

function toggleMic() {
  micOn = !micOn;
  const track = localStream?.getAudioTracks()[0];
  if (track) track.enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  const track = localStream?.getVideoTracks()[0];
  if (track) track.enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) {
    socket.emit("report");
    showStatus("⚠️ Reported. Finding new match…");
    next();
  }
}

// ✅ next() — no more page reload!
function next() {
  cleanupPeer();
  remoteVideo.srcObject = null;
  messages.innerHTML = "";
  socket.emit("next"); // ✅ server handles re-matching
  showStatus("🔄 Finding next match...");
}

/* ==============================
   5️⃣ CLEANUP (no reload)
================================ */
function cleanupPeer() {
  try {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      pc = null;
    }
  } catch (e) {
    console.warn("Peer close error:", e);
  }
  iceCandidateQueue = [];
  remoteDescSet = false;
}

/* ==============================
   6️⃣ HELPERS
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
  const id = "omingle-status";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = `
      position:fixed; bottom:50px; left:50%;
      transform:translateX(-50%);
      background:rgba(0,0,0,0.75); color:#fff;
      padding:8px 16px; border-radius:8px;
      font-size:14px; z-index:1000;
    `;
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 2500);
    }/* ==============================
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
  try {
    socket.disconnect();
  } catch (e) {}
  setTimeout(() => location.reload(), 400);
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
