// ================================
//  BRAND & SERVER SETTINGS
// ================================
const APP_NAME = "Omingle";
const SERVER_URL = "https://gaaji-server.onrender.com";

// ================================
//  SOCKET.IO CONNECTION
// ================================
const socket = io(SERVER_URL, {
  transports: ["websocket"]
});

// ================================
//  DOM ELEMENTS
// ================================
const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

// ================================
//  STATE
// ================================
let pc = null;
let localStream = null;
let micOn = true;
let camOn = true;

// ================================
//  ICE CONFIG (✅ REAL TURN ADDED)
// ================================
const iceConfig = {
  iceServers: [
    // STUN (for same WiFi / easy NAT)
    { urls: "stun:stun.l.google.com:19302" },

    // ✅ TURN (REQUIRED for mobile & different networks)
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "YOUR_TURN_USERNAME",   // 👈 REPLACE
      credential: "YOUR_TURN_PASSWORD"  // 👈 REPLACE
    }
  ],
  iceTransportPolicy: "all"
};

// ================================
//  1️⃣ MEDIA INITIALIZATION
// ================================
async function initMedia() {
  if (localStream) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;
    localVideo.muted = true;
    await localVideo.play().catch(() => {});
  } catch (err) {
    alert(`Camera or microphone permission denied on ${APP_NAME}`);
    console.error(err);
  }
}

initMedia();

// ================================
//  2️⃣ PEER CONNECTION
// ================================
function createPeerConnection() {
  pc = new RTCPeerConnection(iceConfig);

  // Add local tracks
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideo.play().catch(() => {});
  };

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("signal", event.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === "failed" ||
      pc.connectionState === "disconnected"
    ) {
      resetConnection();
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log("ICE gathering:", pc.iceGatheringState);
  };
}

// ================================
//  3️⃣ SOCKET EVENTS
// ================================
socket.on("matched", async ({ initiator }) => {
  await initMedia();
  createPeerConnection();

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", offer);
  }
});

socket.on("signal", async data => {
  if (!pc) {
    await initMedia();
    createPeerConnection();
  }

  try {
    if (data.type === "offer") {
      await pc.setRemoteDescription(data);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", answer);
    } else if (data.type === "answer") {
      await pc.setRemoteDescription(data);
    } else if (data.candidate) {
      await pc.addIceCandidate(data);
    }
  } catch (err) {
    console.warn("Signaling error:", err);
  }
});

socket.on("chat", msg => {
  messages.innerHTML += `<div>Stranger: ${escapeHtml(msg)}</div>`;
  scrollMessagesToBottom();
});

socket.on("peer-disconnected", resetConnection);
socket.on("reported", () => alert(`You were reported on ${APP_NAME}`));
socket.on("banned", () => alert(`You are temporarily banned from ${APP_NAME}`));

// ================================
//  4️⃣ CONTROLS
// ================================
function send() {
  const input = document.getElementById("text");
  if (!input.value) return;

  messages.innerHTML += `<div>You: ${escapeHtml(input.value)}</div>`;
  socket.emit("chat", input.value);
  input.value = "";
  scrollMessagesToBottom();
}

function toggleMic() {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => (t.enabled = micOn));
}

function toggleCam() {
  if (!localStream) return;
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => (t.enabled = camOn));
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

// ================================
//  5️⃣ SAFE RESET (NO RELOAD)
// ================================
function resetConnection() {
  try {
    if (pc) {
      pc.close();
      pc = null;
    }
  } catch (e) {
    console.warn(e);
  }

  remoteVideo.srcObject = null;

  if (socket.connected) socket.disconnect();
  socket.connect();
}

// ================================
//  6️⃣ HELPERS
// ================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    el.style.position = "fixed";
    el.style.bottom = "50px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.background = "rgba(0,0,0,0.75)";
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
