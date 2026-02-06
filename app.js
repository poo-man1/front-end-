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
let peerId = null;             // <-- the other socket id
let micOn = true;
let camOn = true;

// ICE config (STUN; add TURN for production)
const iceConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ==============================
   1) GET CAMERA FIRST
================================ */
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localVideo.muted = true;     // local must be muted to avoid echo
    remoteVideo.muted = false;   // remote should be audible

    // Tell server we're ready to be matched only after media is ready
    socket.emit("ready");
  } catch (err) {
    alert(`Camera or mic permission denied on ${APP_NAME}`);
    console.error(err);
  }
}
initMedia();

/* ==============================
   2) CREATE PEER CONNECTION
================================ */
function createPeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection(iceConfig);

  // Add local tracks to send
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Build a dedicated remote MediaStream and add inbound tracks to it
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  pc.ontrack = (event) => {
    // Some browsers may not populate event.streams; use the track directly
    const t = event.track;
    if (t && !remoteStream.getTracks().some(x => x.id === t.id)) {
      remoteStream.addTrack(t);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && peerId) {
      socket.emit("signal", { to: peerId, data: { type: "candidate", candidate: event.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      resetConnection(true); // auto-find next if disconnected
    }
  };

  return pc;
}

/* ==============================
   3) SOCKET EVENTS (ADDRESSED)
================================ */
socket.on("connect", () => {
  console.log("Connected. My id:", socket.id);
});

socket.on("matched", async ({ initiator, peer }) => {
  // Server must send the partner's id
  console.log("Matched:", { initiator, peer });
  peerId = peer;
  createPeerConnection();

  if (initiator) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: peerId, data: offer });
  }
});

// Strict addressed relay from server: { from, data }
socket.on("signal", async ({ from, data }) => {
  if (!pc) createPeerConnection();

  // Safety: if anything echoes back, ignore our own id
  if (from === socket.id) return;

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
