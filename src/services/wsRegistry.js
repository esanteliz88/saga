const connections = new Map();

export function registerConnection(wa_id, ws) {
  if (!wa_id || !ws) return false;
  connections.set(String(wa_id), ws);
  return true;
}

export function unregisterConnection(wa_id) {
  if (!wa_id) return false;
  return connections.delete(String(wa_id));
}

export function getConnection(wa_id) {
  return connections.get(String(wa_id));
}

export function sendTo(wa_id, payload) {
  const ws = getConnection(wa_id);
  if (!ws || ws.readyState !== ws.OPEN) return false;
  try {
    ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return true;
  } catch (e) {
    return false;
  }
}

export function unregisterByWs(wsRef) {
  if (!wsRef) return false;
  for (const [wa_id, socket] of connections.entries()) {
    if (socket === wsRef) {
      connections.delete(wa_id);
      return true;
    }
  }
  return false;
}

export default { registerConnection, unregisterConnection, getConnection, sendTo, unregisterByWs };
