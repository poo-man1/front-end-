// ===== Brand & Server Settings =====
const APP_NAME = "Omingle";
const SERVER_URL = "https://gaaji-server.onrender.com";

// ===== Socket.IO =====
const socket = io(SERVER_URL, {
  transports: ["polling", "websocket"],
  reconnectionAttempts: 5,
  reconnectionDelay: 3000,
  timeout: 25000
});

const localVideo  = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages    = document.getElementById("messages");

let pc            = null;
let localStream   = null;
let micOn         = true;
let camOn         = true;
let isInitiator   = false;
let makingOffer   = false;
let ignoreOffer   = false;
let iceCandidateQueue = [];

const iceConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    {
      urls: "turn:openrelayproject.org:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:relay.metered.ca:80",
      username: "e8dd65f0a9c494e4a7b84a59",
      credential: "uWDBCkHMIwdBqEz3"
    },
    {
      urls: "turn:relay.metered.ca:443",
      username: "e8dd65f0a9c494e4a7b84a59",
      credential: "uWDBCkHMIwdBqEz3"
    },
    {
      urls: "turns:relay.metered.ca:443?transport=tcp",
      username: "e8dd65f0a9c494e4a7b84a59",
      credential: "uWDBCkHMIwdBqEz3"
    }
  ],
  iceCandidatePoolSize: 10
};

async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    localVideo.srcObject = localStream;
    localVideo.muted = true;
  } catch (err) {
    alert("Camera/mic denied. Please allow and refresh.");
    console.error(err);
  }
}
initMedia();

function cleanupPeer() {
  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onnegotiationneeded = null;
    pc.close();
    pc = null;
  }
  iceCandidateQueue = [];
  makingOffer = false;
  ignoreOffer = false;
}

function createPeerConnection() {
  cleanupPeer();
  pc = new RTCPeerConnection(iceConfig);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = ({ streams }) => { remoteVideo.srcObject = streams[0]; };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("signal", { type: "candidate", candidate });
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE:", pc.iceConnectionState);
    if (pc.iceConnectionState === "failed" && isInitiator) doOffer(true);
  };

  pc.onconnectionstatechange = () => {
    console.log("Conn:", pc.connectionState);
    if (pc.connectionState === "connected")    showStatus("Connected!");
    if (pc.connectionState === "failed")       showStatus("Connection failed. Press Next.");
    if (pc.connectionState === "disconnected") showStatus("Peer disconnected.");
  };
}

async function doOffer(iceRestart) {
  if (!pc) return;
  try {
    makingOffer = true;
    const offer = await pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: true,
      iceRestart: !!iceRestart
    });
    if (pc.signalingState !== "stable") { makingOffer = false; return; }
    await pc.setLocalDescription(offer);
    socket.emit("signal", pc.localDescription);
  } catch(e) {
    console.error("Offer error:", e);
  } finally {
    makingOffer = false;
  }
}

async function flushICEQueue() {
  for (const c of iceCandidateQueue) {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
  }
  iceCandidateQueue = [];
}

// ===== SOCKET EVENTS =====
socket.on("connect", () => { console.log("Socket:", socket.id); showStatus("Server connected"); });
socket.on("connect_error", (e) => { showStatus("Connecting..."); });
socket.on("waiting", () => showStatus("Waiting for a match..."));

socket.on("matched", ({ initiator }) => {
  isInitiator = initiator;
  console.log("Matched, initiator:", isInitiator);
  showStatus("Matched! Connecting...");
  createPeerConnection();
  if (isInitiator) doOffer(false);
});

socket.on("signal", async (data) => {
  if (!pc) return;
  try {
    if (data.type === "offer") {
      // Perfect Negotiation: polite peer (non-initiator) handles collisions
      const collision = makingOffer || pc.signalingState !== "stable";
      ignoreOffer = isInitiator && collision; // initiator = impolite, ignores colliding offer
      if (ignoreOffer) { console.warn("Glare: ignoring offer"); return; }

      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushICEQueue();
      await pc.setLocalDescription(await pc.createAnswer());
      socket.emit("signal", pc.localDescription);

    } else if (data.type === "answer") {
      if (pc.signalingState !== "have-local-offer") {
        console.warn("Unexpected answer, state:", pc.signalingState);
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushICEQueue();

    } else if (data.candidate) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) {}
      } else {
        iceCandidateQueue.push(data.candidate);
      }
    }
  } catch(e) {
    console.error("Signal error:", e);
  }
});

socket.on("chat", (msg) => {
  messages.innerHTML += "<div><b>Stranger:</b> " + escapeHtml(msg) + "</div>";
  scrollMessagesToBottom();
});

socket.on("peer-disconnected", () => {
  showStatus("Stranger left. Press Next.");
  cleanupPeer();
  remoteVideo.srcObject = null;
});

socket.on("reported", () => alert("You were reported on " + APP_NAME));
socket.on("banned",   () => { alert("You are banned from " + APP_NAME); socket.disconnect(); });

// ===== CONTROLS =====
function send() {
  const input = document.getElementById("text");
  if (!input.value.trim()) return;
  messages.innerHTML += "<div><b>You:</b> " + escapeHtml(input.value) + "</div>";
  socket.emit("chat", input.value);
  input.value = "";
  scrollMessagesToBottom();
}

function toggleMic() {
  micOn = !micOn;
  const t = localStream && localStream.getAudioTracks()[0];
  if (t) t.enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  const t = localStream && localStream.getVideoTracks()[0];
  if (t) t.enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) { socket.emit("report"); next(); }
}

function next() {
  cleanupPeer();
  remoteVideo.srcObject = null;
  messages.innerHTML = "";
  socket.emit("next");
  showStatus("Finding next match...");
}

// ===== HELPERS =====
function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function scrollMessagesToBottom() { messages.scrollTop = messages.scrollHeight; }
function showStatus(text) {
  const id = "omingle-status";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = "position:fixed;bottom:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:10px 20px;border-radius:30px;font-size:14px;z-index:9999;font-family:inherit;pointer-events:none;border:1px solid rgba(244,63,94,0.5);white-space:nowrap;";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = "none", 3000);
}
