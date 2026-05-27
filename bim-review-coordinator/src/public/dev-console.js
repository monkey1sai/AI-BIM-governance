const projectId = document.getElementById("projectId");
const modelVersionId = document.getElementById("modelVersionId");
const sessionId = document.getElementById("sessionId");
const userId = document.getElementById("userId");
const displayName = document.getElementById("displayName");
const mode = document.getElementById("mode");
const eventBody = document.getElementById("eventBody");
const httpOutput = document.getElementById("httpOutput");
const socketOutput = document.getElementById("socketOutput");
const socketState = document.getElementById("socketState");

let socket = null;

function sessionPath(suffix = "") {
  if (!sessionId.value) throw new Error("請先建立或輸入 session_id");
  return `/api/review-sessions/${sessionId.value}${suffix}`;
}

function participantBody() {
  return { user_id: userId.value, display_name: displayName.value };
}

async function httpCall(method, path, body) {
  httpOutput.textContent = `${method} ${path}\n載入中...`;
  const init = { method, headers: { Accept: "application/json" } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, init);
    const text = await response.text();
    let payload = text;
    try {
      payload = JSON.parse(text);
      if (payload.session_id) sessionId.value = payload.session_id;
      payload = JSON.stringify(payload, null, 2);
    } catch {}
    httpOutput.textContent = `${response.status} ${response.statusText}\n${payload}`;
  } catch (error) {
    httpOutput.textContent = String(error);
  }
}

async function createSession() {
  const conversionReviewPayload =
    typeof window.prepareConversionReviewPayload === "function"
      ? await window.prepareConversionReviewPayload()
      : typeof window.getLatestConversionReviewPayload === "function"
      ? window.getLatestConversionReviewPayload()
      : null;
  const body = {
    project_id: projectId.value,
    model_version_id: modelVersionId.value,
    created_by: userId.value,
    mode: mode.value,
    options: { auto_allocate_kit: true }
  };
  if (conversionReviewPayload && Array.isArray(conversionReviewPayload.artifact_bindings)) {
    Object.assign(body, conversionReviewPayload);
  }
  return httpCall("POST", "/api/review-sessions", body);
}

function getSession() {
  return httpCall("GET", sessionPath());
}

function joinSessionHttp() {
  return httpCall("POST", sessionPath("/join"), participantBody());
}

function leaveSessionHttp() {
  return httpCall("POST", sessionPath("/leave"), participantBody());
}

function getStreamConfig() {
  return httpCall("GET", sessionPath("/stream-config"));
}

function getEvents() {
  return httpCall("GET", sessionPath("/events"));
}

function postEvent() {
  return httpCall("POST", sessionPath("/events"), JSON.parse(eventBody.value));
}

function getBootstrap() {
  return httpCall("GET", `/api/model-versions/${modelVersionId.value}/review-bootstrap`);
}

function appendSocket(message, payload) {
  const line = `${new Date().toISOString()} ${message} ${payload === undefined ? "" : JSON.stringify(payload)}`;
  socketOutput.textContent = socketOutput.textContent === "尚未收到 socket 事件。" ? line : `${line}\n${socketOutput.textContent}`;
}

function connectSocket() {
  if (socket?.connected) return;
  socket = io("/review", { transports: ["websocket", "polling"] });
  socket.on("connect", () => {
    socketState.textContent = "已連線";
    appendSocket("connect", { id: socket.id });
  });
  socket.on("disconnect", (reason) => {
    socketState.textContent = "未連線";
    appendSocket("disconnect", { reason });
  });
  socket.onAny((event, payload) => appendSocket(event, payload));
}

function disconnectSocket() {
  socket?.disconnect();
}

function emit(event, payload) {
  if (!socket?.connected) {
    appendSocket("clientWarning", { error: "Socket 尚未連線。" });
    return;
  }
  socket.emit(event, payload, (ack) => appendSocket(`${event}:ack`, ack));
  appendSocket(`${event}:sent`, payload);
}

function baseSocketPayload() {
  if (!sessionId.value) throw new Error("請先建立或輸入 session_id");
  return { session_id: sessionId.value, user_id: userId.value, display_name: displayName.value };
}

function emitJoin() {
  emit("joinSession", baseSocketPayload());
}

function emitLeave() {
  emit("leaveSession", baseSocketPayload());
}

function emitHeartbeat() {
  emit("heartbeat", { session_id: sessionId.value || "review_session_demo_001", actor_id: userId.value });
}

function applyStreamEndpointParams(params, streamConfig) {
  const binding = Array.isArray(streamConfig?.kit_instance_bindings)
    ? streamConfig.kit_instance_bindings[0]
    : null;
  const endpoint = binding?.stream_config || streamConfig?.webrtc || {};
  if (binding?.kit_instance_id) params.set("kitInstanceId", binding.kit_instance_id);
  if (endpoint.signalingServer) params.set("signalingServer", endpoint.signalingServer);
  if (endpoint.signalingPort) params.set("signalingPort", String(endpoint.signalingPort));
  if (endpoint.mediaServer) params.set("mediaServer", endpoint.mediaServer);
  if (endpoint.mediaPort !== undefined && endpoint.mediaPort !== null) {
    params.set("mediaPort", String(endpoint.mediaPort));
  }
  params.set("streamTimeoutMs", "90000");
}

async function openViewerWithSession() {
  if (!sessionId.value) {
    if (typeof window.startDemoSession === "function") {
      await window.startDemoSession();
    } else {
      await createSession();
    }
  }
  if (!sessionId.value) {
    httpOutput.textContent = "開啟瀏覽器審查端失敗：尚未取得 session_id。請先完成轉檔並建立本場審查會議。";
    return;
  }
  const params = new URLSearchParams({
    sessionId: sessionId.value,
    projectId: projectId.value,
    modelVersionId: modelVersionId.value,
    userId: userId.value,
    displayName: displayName.value
  });
  if (sessionId.value) {
    try {
      const response = await fetch(sessionPath("/stream-config"), { headers: { Accept: "application/json" } });
      if (response.ok) {
        applyStreamEndpointParams(params, await response.json());
      }
    } catch (error) {
      console.warn("Unable to attach stream endpoint params to viewer URL", error);
    }
  }
  const viewer = window.open(`/ui/open?session=${encodeURIComponent(sessionId.value)}`, "bim_review_primary_viewer");
  viewer?.focus?.();
}
