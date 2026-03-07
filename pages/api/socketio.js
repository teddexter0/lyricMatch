// Health check for Socket.io server
export default function handler(req, res) {
  res.status(200).json({ status: 'ok', message: 'Socket.io running via custom server' });
}
