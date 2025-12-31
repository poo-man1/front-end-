const socket = io("https://gaaji-server.onrender.com", {
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
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
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
    alert("Camera or mic permission denied");
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
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  pc.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = event => {
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

socket.on("signal", async data => {
  if (!pc) createPeerConnection();

  if (data.type === "offer") {
    await pc.setRemoteDescription(data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", answer);
  }
  else if (data.type === "answer") {
    await pc.setRemoteDescription(data);
  }
  else {
    await pc.addIceCandidate(data);
  }
});

socket.on("chat", msg => {
  messages.innerHTML += `<div>Stranger: ${msg}</div>`;
});

socket.on("peer-disconnected", resetConnection);
socket.on("reported", () => alert("You were reported"));
socket.on("banned", () => alert("You are temporarily banned"));

/* ==============================
   4️⃣ CONTROLS
================================ */
function send() {
  const input = document.getElementById("text");
  if (!input.value) return;

  messages.innerHTML += `<div>You: ${input.value}</div>`;
  socket.emit("chat", input.value);
  input.value = "";
}

function toggleMic() {
  micOn = !micOn;
  localStream.getAudioTracks()[0].enabled = micOn;
}

function toggleCam() {
  camOn = !camOn;
  localStream.getVideoTracks()[0].enabled = camOn;
}

function report() {
  if (confirm("Report this user?")) {
    socket.emit("report");
    resetConnection();
  }
}

function next() {
  resetConnection();
}

/* ==============================
   5️⃣ RESET (SAFE)
================================ */
function resetConnection() {
  if (pc) {
    pc.close();
    pc = null;
  }
  socket.disconnect();
  setTimeout(() => location.reload(), 500);
}
