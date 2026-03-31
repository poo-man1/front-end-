// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO Connection =====
// ✅ polling first so Render cold-start doesn't kill the connection
const socket = io(SERVER_URL, {
  transports: ["polling", "websocket"],
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  timeout: 20000
});

const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

let pc = null;
let localStream = null;
let micOn = true;
let camOn = true;

// ✅ ICE candidate queue — fixes race condition where candidates
//    arrive before remote description is set
let iceCandidateQueue = [];
let remoteDescSet = false;

// ✅ Multiple STUN servers + free TURN for cross-network connections
const iceConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    // ✅ Free TURN — handles symmetric NAT (mobile data, office networks)
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
  iceCandidatePoolSize: 10 // ✅ pre-gather candidates for faster connect
};

/* ==============================
   1️⃣ GET CAMERA & MIC
================================ */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
    localVideo.muted = true; // prevent echo
  } catch (err) {
    alert(`Camera or mic permission denied on ${APP_NAME}. Please allow access and refresh.`);
    console.error(err);
  }
}

initMedia();

/* ==============================
   2️⃣ CREATE PEER CONNECTION
================================ */
function createPeerConnection() {
  // Clean up any existing connection first
  if (pc) {
    pc.close();
    pc = null;
  }
  iceCandidateQueue = [];
  remoteDescSet = false;

  pc = new RTCPeerConnection(iceConfig);

  // Add local tracks
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Show remote video when tracks arrive
  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  // Send ICE candidates to partner via signaling server
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", { type: "candidate", candidate: event.candidate });
    }
  };

  // Connection state logging + UI feedback
  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
    if (pc.connectionState === "connected") {
      showStatus("✅ Connected!");
    } else if (pc.connectionState === "failed") {
      showStatus("❌ Connection failed. Try pressing Next.");
    } else if (pc.connectionState === "disconnected") {
      showStatus("⚠️ Peer disconnected.");
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", pc.iceConnectionState);
  };
}

/* ==============================
   ✅ DRAIN ICE QUEUE
   Flush any candidates that arrived
   before remote description was set
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
socket.on("connect", () => {
  console.log("✅ Socket connected:", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("❌ Socket connection error:", err.message);
  showStatus("⏳ Connecting to server...");
});

socket.on("waiting", () => {
  showStatus("⏳ Waiting for a match...");
});

socket.on("matched", async ({ initiator }) => {
  showStatus("🎉 Matched! Connecting...");
  createPeerConnection();

  if (initiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", offer);
    } catch (e) {
      console.error("Offer error:", e);
    }
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
      // ✅ Queue if remote description not ready yet
      const candidate = data.candidate || data;
      if (remoteDescSet && pc) {
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
  showStatus("👋 Stranger disconnected. Press Next for a new match.");
  cleanupPeer();
  remoteVideo.srcObject = null;
});

socket.on("reported", () => alert(`You were reported on ${APP_NAME}.`));

socket.on("banned", () => {
  alert(`You are temporarily banned from ${APP_NAME}.`);
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

// ✅ No more page reload — server handles re-matching
function next() {
  cleanupPeer();
  remoteVideo.srcObject = null;
  messages.innerHTML = "";
  socket.emit("next");
  showStatus("🔄 Finding next match...");
}

/* ==============================
   5️⃣ CLEANUP (no page reload)
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
      background:rgba(0,0,0,0.8); color:#fff;
      padding:10px 20px; border-radius:30px;
      font-size:14px; z-index:9999;
      font-family:inherit; pointer-events:none;
      border: 1px solid rgba(244,63,94,0.5);
    `;
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = "none"), 3000);
}
