// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO =====
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

// ICE config
const iceConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ==============================
   1️⃣ INIT MEDIA + START MATCHING
================================ */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;
    localVideo.muted = true;

    // 🔥 START MATCHING AFTER CAMERA READY
    socket.emit("find-partner");

  } catch (err) {
    alert(`Camera/Mic permission denied on ${APP_NAME}`);
    console.error(err);
  }
}

initMedia();

/* ==============================
   2️⃣ PEER CONNECTION
================================ */
function createPeerConnection() {
  pc = new RTCPeerConnection(iceConfig);

  localStream.getTracks().forEach(track => {
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
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      resetPeerOnly();
    }
  };
}

/* ==============================
   3️⃣ SOCKET EVENTS
================================ */
socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("matched", async ({ initiator }) => {
  showStatus("Connected to stranger ✅");

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
    try {
      await pc.addIceCandidate(data);
    } catch (e) {
      console.warn("ICE error", e);
    }
  }
});

socket.on("chat", (msg) => {
  messages.innerHTML += `<div>Stranger: ${escapeHtml(msg)}</div>`;
  scrollMessagesToBottom();
});

socket.on("peer-disconnected", () => {
  showStatus("Stranger left 😢");
  next();
});

socket.on("reported", () => alert("You were reported"));
socket.on("banned", () => alert("You are temporarily banned"));

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
  const track = localStream.getAudioTracks()[0];
  if (track) track.enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  const track = localStream.getVideoTracks()[0];
  if (track) track.enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) {
    socket.emit("report");
    showStatus("Reported. Finding new match…");
    next();
  }
}

function next() {
  showStatus("Finding new stranger…");

  resetPeerOnly();

  remoteVideo.srcObject = null;
  messages.innerHTML = "";

  socket.emit("next");          // inform server
  socket.emit("find-partner");  // 🔥 find new match
}

/* ==============================
   5️⃣ RESET (SAFE)
================================ */
function resetPeerOnly() {
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
    el.style.position = "fixed";
    el.style.bottom = "60px";
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
  el._t = setTimeout(() => {
    el.style.display = "none";
  }, 2000);
}
