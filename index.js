import { createBareServer } from "@tomphttp/bare-server-node";
import express from "express";
import { createServer } from "node:http";
import { publicPath } from "ultraviolet-static";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { join } from "node:path";
import { hostname } from "node:os";
import compression from 'compression';
import fs from "fs";

const bare = createBareServer("/bare/");
const app = express();

const compressionOptions = {
  filter: (req, res) => {
    return true;
  }
};

app.use(compression(compressionOptions));

const staticOptions = {
  maxAge: '1y',
};

app.use(express.static(publicPath, staticOptions));

// Custom cache-control headers for proxy responses
app.get("/", (req, res) => {
  const file = join(publicPath, "index.html");

  // Check if the client has a cached version of the file
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince) {
    const lastModified = fs.statSync(file).mtime;
    if (lastModified && Date.parse(ifModifiedSince) >= lastModified.getTime()) {
      // The file hasn't been modified, send a 304 response
      res.status(304).end();
      return;
    }
  }

  // Set the last modified header for caching
  const fileStat = fs.statSync(file);
  const lastModified = fileStat.mtime.toUTCString();
  res.setHeader('Last-Modified', lastModified);

  // Set cache control headers for the file
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Set cache-control for index.html (1 hour)

  // Serve the file
  res.sendFile(file);
});

app.use("/uv/", express.static(uvPath, staticOptions));

app.get("/popup", (req, res) => {
  const html = `
    <script>
      window.onload = function() {
        const popup = window.open('about:blank', 'popup', 'width=800,height=600');
        fetch('/', { method: 'GET' })
          .then(response => response.text())
          .then(content => {
            popup.document.open();
            popup.document.write(content);
            popup.document.close();
          });
      }
    </script>
  `;
  res.send(html);
});

app.use((req, res) => {
  res.status(404);
  res.sendFile(join(publicPath, "404.html"));
});

const server = createServer();

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

server.on("listening", () => {
  const address = server.address();

  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(
    `\thttp://${
      address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
  process.exit(0);
}

server.listen({
  port,
});
