const express = require('express');
const { EventEmitter } = require('events');

const sseRouter = express.Router();
const bus = new EventEmitter();
bus.setMaxListeners(0);

function setSSEHeaders(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

sseRouter.get('/events', (req, res) => {
  setSSEHeaders(res);
  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ id: clientId, ts: new Date().toISOString() })}\n\n`);

  const onBroadcast = ({ event, data, ts }) => {
    res.write(`id: ${Date.now()}\n`);
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify({ ...data, ts })}\n\n`);
  };
  bus.on('broadcast', onBroadcast);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: "keepalive"\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('broadcast', onBroadcast);
    res.end();
  });
});

function sseBroadcast(event, data) {
  bus.emit('broadcast', { event, data, ts: new Date().toISOString() });
}

module.exports = { sseRouter, sseBroadcast };
