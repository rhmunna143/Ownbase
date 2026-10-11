const http = require('http');
const os = require('os');

const localIps = [];
const interfaces = os.networkInterfaces();
for (const name of Object.keys(interfaces)) {
  for (const net of interfaces[name] || []) {
    if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
      localIps.push(net.address);
    }
  }
}

console.log('Detected network IPs:', localIps);

const caddyRoutes = [
  // 1. FileBrowser
  {
    '@id': 'route-files',
    match: [{ host: ['files.localhost', 'files.local', ...localIps.flatMap(ip => ['files.' + ip + '.nip.io', 'files.' + ip + '.sslip.io'])] }],
    handle: [{
      handler: 'reverse_proxy',
      headers: { request: { set: { Host: ['{http.reverse_proxy.upstream.hostport}'] } } },
      upstreams: [{ dial: '127.0.0.1:8080' }]
    }],
    terminal: true
  },
  // 2. Ollama AI Hub
  {
    '@id': 'route-ai',
    match: [{ host: ['ai.localhost', 'ai.local', ...localIps.flatMap(ip => ['ai.' + ip + '.nip.io', 'ai.' + ip + '.sslip.io'])] }],
    handle: [{
      handler: 'reverse_proxy',
      headers: { request: { set: { Host: ['{http.reverse_proxy.upstream.hostport}'] } } },
      upstreams: [{ dial: '127.0.0.1:11434' }]
    }],
    terminal: true
  },
  // 3. MinIO S3 Console
  {
    '@id': 'route-s3',
    match: [{ host: ['s3.localhost', 's3.local', ...localIps.flatMap(ip => ['s3.' + ip + '.nip.io', 's3.' + ip + '.sslip.io'])] }],
    handle: [{
      handler: 'reverse_proxy',
      headers: { request: { set: { Host: ['{http.reverse_proxy.upstream.hostport}'] } } },
      upstreams: [{ dial: '127.0.0.1:9000' }]
    }],
    terminal: true
  },
  // 4. Web API Bridge Route (/api/*)
  {
    '@id': 'route-api-bridge',
    match: [{ path: ['/api/*', '/api'] }],
    handle: [{
      handler: 'reverse_proxy',
      headers: { request: { set: { Host: ['127.0.0.1:3001'] } } },
      upstreams: [{ dial: '127.0.0.1:3001' }]
    }],
    terminal: true
  },
  // 5. Catch-All Route: Hub Web Dashboard (Port 3000)
  {
    '@id': 'route-hub-dashboard',
    handle: [{
      handler: 'reverse_proxy',
      headers: { request: { set: { Host: ['{http.reverse_proxy.upstream.hostport}'] } } },
      upstreams: [{ dial: '127.0.0.1:3000' }]
    }],
    terminal: true
  }
];

const fullConfig = {
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [':80'],
          routes: caddyRoutes
        }
      }
    }
  }
};

const data = JSON.stringify(fullConfig);
const req = http.request({
  hostname: '127.0.0.1',
  port: 2019,
  path: '/load',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`Caddy /load HTTP ${res.statusCode}:`, body || 'OK');
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('Caddy request error:', err.message);
  process.exit(1);
});

req.write(data);
req.end();
