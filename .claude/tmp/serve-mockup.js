const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8935;
http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/clients_service_matrix_preview.html' : req.url;
  filePath = path.join(__dirname, decodeURIComponent(filePath.split('?')[0]));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}).listen(PORT, () => console.log('serving mockup on ' + PORT));
