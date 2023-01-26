#!/usr/bin/env node

// it works at least
// ------------------------------------------------------------------------
var http = require('http');
var fs = require('fs');
var path = require('path');
const Emitter = require('events').EventEmitter;
const crypto = require('crypto');

// Options
var pathRunningFrom = process.cwd()




//-----------------------------------------------------------
// Pocket Websockets :|
//-----------------------------------------------------------

//Constants
const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PL_LARGE = 126;
const FO_FINISHED = 129;

//Finished/Opcode Values
const FO_UNFINISHED = 1;
const FO_CONTINUATION = 128;
const FO_CLOSE = 136;
const FO_END = 0;
const FO_PING = 0;

//Receiving Data States
const STATE_START = 0;
const STATE_GET_LENGTH = 1;
const STATE_GET_MASK = 2;
const STATE_GET_DATA = 3;


//Payload/Buffer
const PL_MAX = 50000;
const EMPTY_BUFFER = Buffer.allocUnsafe(0);

class WsServer extends Emitter {
   constructor(config) {
      super();
      this.config = config;
      this.clientCounter = 0;

      this.server = this.startServer(config.ssl);
      
      this.server.listen(this.config.port);
      this.server.on('upgrade', this.httpUpgrade);
      this.server.wsServer = this;
   }

   startServer() {
      // console.log('Starting Server (Non-SSL)');
      var http = require('http');
      var server = http.createServer(this.httpRequest);
      return server;
   }

   httpRequest(request, response) {
      if (!this.wsServer.config.html) return;
      response.writeHead(200);
      fs.readFile(this.wsServer.config.html, function (error, content) {
         response.end(content);
      });
   }

   httpUpgrade(request, socket, head) {
      var secWebSocketKey = request.headers['sec-websocket-key'] + WS_MAGIC_STRING;
      var hashedKey = crypto
         .createHash('SHA1')
         .update(secWebSocketKey)
         .digest('base64');

      this.wsServer.writeUpgradeHeader(socket, hashedKey);
      this.wsServer.clientCounter += 1;
      this.wsServer.initSocket(socket);

      this.wsServer.emit('connect', socket.ws);
   };

   writeUpgradeHeader(socket, hashedKey) {
      socket.write(
         'HTTP/1.1 101 Switching Protocols\r\n'
         + 'Upgrade: websocket\r\n'
         + 'Connection: Upgrade\r\n'
         + `Sec-WebSocket-Accept: ${hashedKey}\r\n\r\n`
      );
   }

   initSocket(socket) {
      // Socket Configuration
      socket.setTimeout(0);
      socket.allowHalfOpen = false;
      socket.setNoDelay(true);

      // Link with socket
      socket.ws = new WsSocket(this, socket);

      socket.on('data', function (newData) {
         if (socket.id == -1) return;
         this.ws.buffer = Buffer.concat([socket.ws.buffer, newData]);
         this.ws.receivedData(newData.length);
      });

      socket.on('close', function () {
         this.ws.server.emit('disconnect', this.ws);
      });

      socket.on('end', function () {
         this.destroy();
      });
   }

   send(to, data) {
      if (data.length < PL_LARGE) {
         var header = Buffer.allocUnsafe(2);
         header.writeUInt8(FO_FINISHED, 0);
         header.writeUInt8(data.length, 1);
      } else {
         var header = Buffer.allocUnsafe(4);
         header.writeUInt8(FO_FINISHED, 0);
         header.writeUInt8(PL_LARGE, 1);
         header.writeUInt16BE(data.length, 2);
      }
      var bufferData = Buffer.from(data);
      var headerWithData = Buffer.concat([header, bufferData]);
      to.socket.write(headerWithData);
   }
}


class WsSocket extends Emitter {
   constructor(server, socket) {
      super();
      this.socket = socket;
      this.server = server;
      this.id = server.clientCounter.toString();
      this.buffer = EMPTY_BUFFER;
      this.state = STATE_START;
      this.payloadLength = 0;
      this.cont = false;
      this.continuationBuffer = EMPTY_BUFFER;
      this.finished = true;
   }

   bufferRead(cnt) {
      var read = Buffer.allocUnsafe(cnt);
      for (var i = 0; i < cnt; i++) {
         read.writeUInt8(this.buffer[i], i);
      }
      this.buffer = this.buffer.slice(i, this.buffer.length);
      return read;
   }

   receivedData(payLoadLength) {
      switch (this.state) {
         case STATE_START:
            this.start(payLoadLength);
            break;
         case STATE_GET_LENGTH:
            this.getLength(payLoadLength);
            break;
         case STATE_GET_MASK:
            this.getMask(payLoadLength);
            break;
         case STATE_GET_DATA:
            this.getData(payLoadLength);
            break;
      }
   }

   start(newDataLength) {
      if (this.buffer.length < 2) return;
      newDataLength -= 2;
      this.finOpCode = this.bufferRead(1)[0];
      if (this.finOpCode !== FO_FINISHED) {
         switch (this.finOpCode) {
            case FO_UNFINISHED:
               this.finished = false;
               break;
            case FO_CONTINUATION:
               this.finished = true;
               break;
            default:
               this.socket.end();
               return;
         }
         if (this.finOpCode == FO_UNFINISHED) {
            this.finished = false;
         }
         if (this.finOpCode == FO_CONTINUATION) {
            this.finished = true;
         }
         this.cont = true;
      }
      this.payloadLength = this.bufferRead(1)[0] & 0x7f;
      if (this.payloadLength === PL_LARGE) {
         this.state = STATE_GET_LENGTH;
         this.getLength(newDataLength);
      } else {
         this.state = STATE_GET_MASK;
         this.getMask(newDataLength);
      }
   }

   getLength(newDataLength) {
      if (this.buffer.length < 2) return
      newDataLength -= 2;
      this.payloadLength = this.bufferRead(2).readUInt16BE(0);

      this.state = STATE_GET_MASK;
      this.getMask(newDataLength);
   }

   getMask(newDataLength) {
      if (this.buffer.length < 4) return
      newDataLength -= 4;
      this.mask = this.bufferRead(4);
      this.state = STATE_GET_DATA;
      this.getData(newDataLength);
   }

   getData(newDataLength) {
      if (this.buffer.length >= this.payloadLength) {
         // Create Buffer Header
         var payloadOffset = (this.payloadLength < PL_LARGE) ? 2 : 4;
         var response = Buffer.allocUnsafe(this.payloadLength);

         // Unmask Data
         var unMaskedData = '';
         var unMaskedBuffer = this.bufferRead(this.payloadLength);
         for (var i = 0; i < unMaskedBuffer.length; i++) {
            response.writeUInt8(unMaskedBuffer[i] ^ this.mask[i % 4], i);
         }

         // Write back or save for later
         if (this.finished === true) {
            var stringResponse = Buffer.concat([this.continuationBuffer, response]).toString();

            this.server.emit('message', this, stringResponse);
            this.continuationBuffer = EMPTY_BUFFER;
         } else {
            this.continuationBuffer = Buffer.concat([this.continuationBuffer, response]);
         }

         this.state = STATE_START;

         // Response Length
         newDataLength -= response.length;
         if (newDataLength !== 0) {
            process.nextTick(() => { this.start(newDataLength) });
         }
      }
   }
}


//-----------------------------------------------------------
// Web socket server setup
//-----------------------------------------------------------
const server = new WsServer({
   port: 4445
})

var sockets = []
server.on('connect', function (socket) {
   sockets.push(socket)
});

server.on('disconnect', function (socket) {
   sockets = sockets.filter((s) => s.id !== socket.id)
})


//-----------------------------------------------------------
// Watch for file changes
//-----------------------------------------------------------
var lastChange = Date.now()
fs.watch(pathRunningFrom, { recursive: true }, (event, filename) => {
   // console.log('Changed: ', filename) 
   if (Date.now() - lastChange > 1) {
      lastChange = Date.now()
      for (var socket of sockets) {
         server.send(socket, JSON.stringify({ reload: true }))
      }
   }
})



//-----------------------------------------------------------
// Static File Server
//-----------------------------------------------------------
function buildDirectoryList(dirPath, url, response) {
   fs.readdir( dirPath, (err, files) => {
      if (err) {
         response.writeHead(200, { 'Content-Type': 'text/html' });
         response.end('404', 'utf-8');
         return
      } 

      var filesToRender = files.filter(f => !f.startsWith('.'))

      var content = `
         <html><body>
            <style> * { font-family: monospace; }</style>
            <h3>Index of ${url}</h3>
            <div>
               ${filesToRender.map(file => {
                  // Add a / to directories. Allows relative paths
                  if (!file.includes('.')) file += '/' 

                  return `
                     <div>
                        <a href="${path.join(url, file)}">${file}</a>
                     </div>
                  `
               }).join('')}
            </div>
         </body></html>
      `

      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(content, 'utf-8');
   })
}
http.createServer(function (request, response) {
   var requestUrl = request.url.split('?')[0]
   var urlPath = path.join(pathRunningFrom, '.' + requestUrl)
   var filePath = urlPath
   var extName = path.extname(filePath)
   if (!extName) {
      filePath = path.join(filePath, './index.html')
      extName = '.html'
   }

   var contentType = {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.wav': 'audio/wav',
      '.html': 'text/html',
      '.svg': 'image/svg+xml',
   }[extName] || ''


   fs.readFile(filePath, function (error, content) {
      if (error) {
         if (error.code == 'ENOENT') {
            buildDirectoryList(urlPath, requestUrl, response)
         }
         else {
            response.writeHead(500);
            response.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            response.end();
         }
      } else {
         if (contentType === 'text/html') {
            content = content.toString()
            content += `
               <script>
                  // serve-reload bits
                  (() => {
                     function connect() {
                        var ws = new WebSocket('ws://localhost:4445');
                        ws.onopen = function(){ console.log('serve-reload: connected') }
                        ws.onclose = function(){ console.log('serve-reload: disconnected'); setTimeout(() => connect(), 2000) }
                        ws.onmessage =  function(event){ console.log('serve-reload: reloading'); window.location.reload() }
                     }
                     connect()
                  })()
               </script>
            `
         }
         response.writeHead(200, { 'Content-Type': contentType });
         response.end(content, 'utf-8');
      }
   });

}).listen(4444);

console.log('Ready: http://localhost:4444');
