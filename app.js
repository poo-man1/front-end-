// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO Connection =====
const socket = io(SERVER_URL, { transports: ["websocket"] });

// ===== Elements =====
const localVideo  = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages    = document.getElementById("messages");

// ===== State =====
let pc = null;
let localStream = null;
let remoteStream = null;
let micOn = true;
let camOn = true;

// Unique token to detect self-echo through broadcast signaling
const mySigToken =
  (crypto && crypto.randomUUID && crypto.randomUUID()) ||
  ("t" + Math.random().toString(36).slice(2));

const iceConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

/* 1) Get camera *first* */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.muted = true;    // avoid echo
    remoteVideo.muted = false;  // remote should be audible

    // If your server requires it, announce readiness (harmless if ignored)
    socket.emit("ready");
  } catch (err) {
    alert(`Camera or mic permission denied on ${APP_NAME}`);
    console.error(err);
  }
}
initMedia();

/* 2) Create PeerConnection */
function createPeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection(iceConfig);

  // Send our local tracks
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // Build a dedicated remote MediaStream and add inbound tracks to it
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  pc.ontrack = (event) => {
    // Use the track directly (works even when event.streams[0] is empty)
    const t = event.track;
    if (t && !remoteStream.getTracks().some(x => x.id === t.id)) {
      remoteStream.addTrack(t);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { token: mySigToken, data: { type: "candidate", candidate: event.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      resetConnection(true);
    }
  };

  return pc;
}

/* 3) Socket events (token-filtered) */
socket.on("matched", async ({ initiator }) => {
  // Server doesn’t give peer id; we’ll still avoid self-echo using token
  createPeerConnection();

  if (initiator) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socket.emit("signal", { token: mySigToken, data: offer });
  }
});

// Expect broadcasts like: { token, data }
socket.on("signal", async (packet) => {
  // If server still sends bare SDP, normalize to { data: packet }
  const p = packet && packet.data ? packet : { token: undefined, data: packet };

  // Drop anything we ourselves sent (echo)
  if (p.token && p.token === mySigToken) return;

  // Ensure PC exists
  if (!pc) createPeerConnection();

  const data = p.data;
  if (!data) return;

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { token: mySigToken, data: answer });
  } else if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.type === "candidate" && data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.warn("ICE add error", err);
    }
  }
});

/* 4) Chat controls (unchanged) */
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
    resetConnection(true);
  }
}

function next() {
  showStatus("Connecting to the next match…");
  resetConnection(true);
}

/* 5) Reset */
function resetConnection(findNext = false) {
  try {
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
  } catch (e) { console.warn("Peer close error", e); }
  pc = null;

  // Preserve local preview; clear remote
  try {
    if (remoteStream) remoteStream.getTracks().forEach(t => t.stop());
  } catch {}
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  if (findNext) {
    socket.emit("ready"); // harmless if server ignores; useful if it uses a queue
  }
}

/* 6) Helpers */
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
    el.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.7);color:#fff;padding:8px 12px;border-radius:6px;font-size:14px;z-index:1000";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 1800);
}
``
