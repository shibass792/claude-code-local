const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 17890;

function waitForHealth(url, timeoutMs = 15000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
            return;
          }
          retry();
        })
        .on('error', retry);
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Tunnel health check timed out: ${url}`));
        return;
      }
      setTimeout(tick, 400);
    };

    tick();
  });
}

function startStaticServer(filePath, port = DEFAULT_PORT) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Media file not found: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const server = http.createServer((req, res) => {
    if (!req.url || !req.url.includes(fileName)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    stream.pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        localUrl: `http://127.0.0.1:${port}/${fileName}`,
        close: () =>
          new Promise((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

async function startCloudflared(localUrl) {
  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  if (!token) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      'cloudflared',
      ['tunnel', '--url', localUrl, '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('cloudflared did not return a public URL in time'));
    }, 20000);

    const tryResolve = () => {
      const blob = `${stdout}\n${stderr}`;
      const match = blob.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match) {
        clearTimeout(timer);
        resolve({
          publicUrl: match[0],
          close: () => {
            child.kill();
            return Promise.resolve();
          },
        });
      }
    };

    child.stdout.on('data', tryResolve);
    child.stderr.on('data', tryResolve);
    child.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });
  });
}

async function createTemporaryPublicUrl(filePath) {
  const local = await startStaticServer(filePath);
  const tunnel = await startCloudflared(local.localUrl);

  if (tunnel?.publicUrl) {
    return {
      url: `${tunnel.publicUrl}/${path.basename(filePath)}`,
      mode: 'cloudflared',
      close: async () => {
        await tunnel.close();
        await local.close();
      },
    };
  }

  // Meta requires HTTPS; without cloudflared we still return local URL for dev/testing.
  return {
    url: local.localUrl,
    mode: 'local-only',
    close: local.close,
  };
}

module.exports = {
  DEFAULT_PORT,
  waitForHealth,
  startStaticServer,
  startCloudflared,
  createTemporaryPublicUrl,
};
