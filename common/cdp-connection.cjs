"use strict";
function loopbackSocket(value) {
  const url = new URL(value);
  if (
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    Number(url.port) < 1 ||
    Number(url.port) > 65535 ||
    url.username ||
    url.password
  )
    throw Error("Invalid local inspector endpoint.");
  return url.href;
}

// Shared transport. Callers own reconnection; pending calls never survive closure.
async function connect(
  value,
  {
    WebSocketClass = WebSocket,
    connectTimeout = 5000,
    requestTimeout = 6000,
    onEvent = () => {},
    onClose = () => {},
    onListenerError = () => {},
  } = {},
) {
  const endpoint = loopbackSocket(value);
  for (const timeout of [connectTimeout, requestTimeout])
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000)
      throw Error("Invalid inspector timeout.");
  const socket = new WebSocketClass(endpoint),
    pending = new Map();
  let id = 0,
    closed = false,
    notifyClose = false;
  const settle = (requestId, error, result) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(result);
  };
  const disconnected = () => {
    if (closed) return;
    closed = true;
    for (const requestId of pending.keys())
      settle(requestId, Error("Local inspector disconnected."));
    if (notifyClose) {
      try {
        onClose();
      } catch (error) {
        onListenerError(error);
      }
    }
  };
  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    if (Number.isInteger(data.id)) {
      settle(
        data.id,
        data.error
          ? Error(data.error.message || "Local inspector request failed.")
          : null,
        data.result,
      );
    } else if (typeof data.method === "string") {
      try {
        onEvent(data);
      } catch (error) {
        onListenerError(error);
      }
    }
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Error("Local inspector timed out."));
        socket.close();
      }, connectTimeout);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(Error("Local inspector unavailable."));
      };
      socket.onclose = () => {
        clearTimeout(timer);
        disconnected();
        reject(Error("Local inspector disconnected."));
      };
    });
  } catch (error) {
    disconnected();
    socket.close();
    throw error;
  }
  notifyClose = true;
  socket.onclose = disconnected;
  socket.onerror = () => {
    disconnected();
    socket.close();
  };
  return {
    call(method, params = {}) {
      if (closed || socket.readyState !== 1)
        return Promise.reject(Error("Local inspector disconnected."));
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(
          () => settle(requestId, Error("Local inspector request timed out.")),
          requestTimeout,
        );
        pending.set(requestId, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ id: requestId, method, params }));
        } catch (error) {
          settle(requestId, error);
        }
      });
    },
    close() {
      disconnected();
      socket.close();
    },
  };
}
module.exports = { loopbackSocket, connect };
