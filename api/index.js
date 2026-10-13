const express = require('express');
const axios = require('axios');
const { URL } = require('url');

const app = express();

// Enable CORS for all requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

/**
 * Universal Proxy Route: Clean, Fast, and Direct .ts/.m3u8 Streaming
 */
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter (?url=...)');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const targetOrigin = `${parsedUrl.protocol}//${parsedUrl.host}`;
    
    // Upstream headers to bypass anti-hotlinking protection
    const upstreamHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': targetOrigin + '/',
      'Origin': targetOrigin
    };

    const isM3U8 = targetUrl.includes('.m3u8') || req.query.type === 'm3u8';

    if (isM3U8) {
      // Fetch and rewrite M3U8 playlists
      const response = await axios.get(targetUrl, {
        responseType: 'text',
        headers: upstreamHeaders,
        timeout: 10000
      });

      const playlist = response.data;
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1)}`;

      const lines = playlist.split('\n');
      const currentHost = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'https';

      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line;
        }

        let absoluteSegmentUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          absoluteSegmentUrl = new URL(trimmed, baseUrl).toString();
        }

        return `${protocol}://${currentHost}/proxy?url=${encodeURIComponent(absoluteSegmentUrl)}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewrittenLines.join('\n'));
    } else {
      // Direct stream handling for .ts segments (No extra HEAD requests to prevent 500 errors)
      const response = await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        headers: upstreamHeaders,
        timeout: 30000
      });

      res.writeHead(response.status, {
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Proxy Error:', error.message);
    if (!res.headersSent) {
      res.status(500).send(`Proxy Error: ${error.message}`);
    }
  }
});

/**
 * Xtream Codes API & Stream Handler
 */
app.get('/xtream', async (req, res) => {
  const { host, username, password, action, stream_id, type } = req.query;
  
  if (!host || !username || !password) {
    return res.status(400).send('Missing Xtream parameters');
  }

  const cleanHost = host.endsWith('/') ? host.slice(0, -1) : host;
  const currentHost = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';

  if (action === 'live' && stream_id) {
    const streamUrl = `${cleanHost}/live/${username}/${password}/${stream_id}.ts`;
    return res.redirect(`${protocol}://${currentHost}/proxy?url=${encodeURIComponent(streamUrl)}`);
  } 
  
  if ((action === 'movie' || action === 'series') && stream_id) {
    const ext = req.query.ext || 'mp4';
    const streamUrl = `${cleanHost}/${action}/${username}/${password}/${stream_id}.${ext}`;
    return res.redirect(`${protocol}://${currentHost}/proxy?url=${encodeURIComponent(streamUrl)}`);
  } 

  try {
    let apiUrl = `${cleanHost}/player_api.php?username=${username}&password=${password}`;
    if (action) apiUrl += `&action=${action}`;
    if (type) apiUrl += `&type=${type}`;

    const apiResponse = await axios.get(apiUrl);
    res.json(apiResponse.data);
  } catch (error) {
    console.error('Xtream API Error:', error.message);
    res.status(500).send('Failed to communicate with Xtream server');
  }
});

app.get('/', (req, res) => {
  res.send('IPTV Proxy Server is operational');
});

module.exports = app;
