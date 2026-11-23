/* 로컬 개발 서버 — `npm run dev`로 실행. 외부 패키지 없이 Node 기본 모듈만 쓴다. */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;

var ROOT = __dirname;
var START_PORT = Number(process.env.PORT) || 5173;
var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

var server = http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var file = path.join(ROOT, path.normalize(urlPath));
  /* 프로젝트 폴더 밖 파일은 내보내지 않는다 */
  if (file !== ROOT && file.indexOf(ROOT + path.sep) !== 0) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

function listen(port) {
  server.once('error', function (err) {
    if (err.code === 'EADDRINUSE' && port < START_PORT + 20) listen(port + 1);
    else throw err;
  });
  server.listen(port, '127.0.0.1', function () {
    var url = 'http://localhost:' + port + '/';
    console.log('\n  ASCII SYNC dev server');
    console.log('  > ' + url);
    console.log('  (종료: Ctrl+C)\n');
    if (!process.env.NO_OPEN) {
      var cmd = process.platform === 'win32' ? 'start "" "' + url + '"'
        : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
      exec(cmd);
    }
  });
}

listen(START_PORT);
