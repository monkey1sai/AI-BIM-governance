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

function createSession() {
  return httpCall("POST", "/api/review-sessions", {
    project_id: projectId.value,
    model_version_id: modelVersionId.value,
    created_by: userId.value,
    mode: mode.value,
    options: { auto_allocate_kit: true }
  });
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

function emitHighlight() {
  emit("highlightRequest", {
    session_id: sessionId.value || "review_session_demo_001",
    actor_id: userId.value,
    items: [
      {
        prim_path: "/World",
        ifc_guid: "2VJ3sK9L000fake001",
        color: [1, 0, 0, 1],
        label: "示範：從 coordinator 協作控制台送出的高亮",
        source: "coordinator_dev_console",
        issue_id: "ISSUE-DEMO-001"
      }
    ]
  });
}

function emitSelection() {
  emit("selectionUpdate", {
    session_id: sessionId.value || "review_session_demo_001",
    actor_id: userId.value,
    selected_paths: ["/World"]
  });
}

function emitAnnotation() {
  emit("annotationCreate", {
    session_id: sessionId.value || "review_session_demo_001",
    actor_id: userId.value,
    text: "從 coordinator UI 建立的示範標註",
    target: {
      usd_prim_path: "/World",
      ifc_guid: "2VJ3sK9L000fake001"
    }
  });
}

function emitHeartbeat() {
  emit("heartbeat", { session_id: sessionId.value || "review_session_demo_001", actor_id: userId.value });
}

function openViewerWithSession() {
  const params = new URLSearchParams({
    sessionId: sessionId.value,
    projectId: projectId.value,
    modelVersionId: modelVersionId.value,
    userId: userId.value,
    displayName: displayName.value
  });
  window.open(`http://127.0.0.1:5173/?${params.toString()}`, "_blank");
}
