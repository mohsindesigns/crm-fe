require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const app = require('./src/app');

const PORT = parseInt(process.env.PORT || '3002', 10);
const SSL_KEY = process.env.SSL_KEY_PATH;
const SSL_CERT = process.env.SSL_CERT_PATH;

let server;

if (SSL_KEY && SSL_CERT) {
  const credentials = {
    key: fs.readFileSync(SSL_KEY),
    cert: fs.readFileSync(SSL_CERT),
  };
  server = https.createServer(credentials, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => {
  const protocol = SSL_KEY && SSL_CERT ? 'https' : 'http';
  const BASE_URL = process.env.BASE_URL || `${protocol}://localhost:${PORT}`;
  console.log(`[media] server running on ${protocol}://0.0.0.0:${PORT}`);
  console.log(`[media] public files at ${BASE_URL}/files/`);
});
