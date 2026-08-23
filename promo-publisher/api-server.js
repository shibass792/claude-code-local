require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const http = require('http');
const { handleRequest } = require('./modules/api-router');
const { appendLog } = require('./modules/engines/creation-log');

const PORT = Number(process.env.ENGINES_API_PORT ?? 4051);
const HOST = process.env.ENGINES_API_HOST ?? '127.0.0.1';

function startApiServer(options = {}) {
  const port = Number(options.port ?? PORT);
  const host = options.host ?? HOST;

  const server = http.createServer((req, res) => {
    handleRequest(req, res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const bound = server.address();
      const actualPort = typeof bound === 'object' && bound ? bound.port : port;
      const address = `http://${host}:${actualPort}`;
      appendLog({
        engine: 'api',
        event: 'listen',
        message: `Engines API listening on ${address}`,
        data: { host, port: actualPort },
      });
      resolve({ server, address, host, port: actualPort });
    });
  });
}

if (require.main === module) {
  startApiServer()
    .then(({ address }) => {
      console.log(`[engines-api] ${address}`);
    })
    .catch((error) => {
      console.error('[engines-api] failed to start', error);
      process.exit(1);
    });
}

module.exports = { startApiServer, PORT, HOST };
