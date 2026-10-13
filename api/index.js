const express = require('express');
const axios = require('axios');
const { URL } = require('url');

const app = express();

// Enable CORS for all requests so players (VLC, web players) can connect freely
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
 * Universal Proxy Route: Handles .m3u8, .ts, HTTP/HTTPS, and tokenized/extensionless streams
 */
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter (?url=...)');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const isExplicitM3U8 = targetUrl.includes('.m3u8') || req.query.type === 'm3u8';

    if (isExplicitM3U8) {
      return await handleM3U8(targetUrl, parsedUrl, req, res);
    }

    // Inspect headers for extensionless or custom token links (e.g., /live/play/.../id)
    const headResponse = await axios.head(targetUrl, {
      headers: { 'User-Agent': req.headers['user-agent'] || 'VLC/3.0.16 LibVLC/3.0.16' },
      validateStatus: () => true
    });

    const contentType = headResponse.headers['content-type'] || '';
    const isPlaylistContent = contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl');

    if (isPlaylistContent) {
      return await handleM3U8(targetUrl, parsedUrl, req, res);
    } else {
      // Stream binary data (.ts segments, video files, etc.) directly using streams
      const response = await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        headers: { 
          'User-Agent': req.headers['user-agent'] || 'VLC/3.0.16 LibVLC/3.0.16' 
        }
      });

      res.writeHead(response.status, {
        'Content-Type': response.headers['content-type'] || 'video/mp2t',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Proxy Error:', error.message);
    if (!res.headersSent) {
      res.status(500).send('Failed to fetch or stream target URL');
    }
  }
});

/**
 * Helper function to fetch, parse, and rewrite M3U8 playlists and their segment links
 */
async function handleM3U8(targetUrl, parsedUrl, req, res) {
  const response = await axios.get(targetUrl, {
    responseType: 'text',
    headers: { 
      'User-Agent': req.headers['user-agent'] || 'VLC/3.0.16 LibVLC/3.0.16' 
    }
  });

  const playlist = response.data;
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1)}`;

  const lines = playlist.split('\n');
  const currentHost = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';

  const rewrittenLines = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return line; // Keep comments and tags intact
    }

    let absoluteSegmentUrl = trimmed;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      absoluteSegmentUrl = new URL(trimmed, baseUrl).toString();
    }

    // Route every segment (.ts or other chunks) back through the proxy
    return `${protocol}://${currentHost}/proxy?url=${encodeURIComponent(absoluteSegmentUrl)}`;
  });

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  return res.send(rewrittenLines.join('\n'));
}

/**
 * Xtream Codes API & Stream Handler
 */
app.get('/xtream', async (req, res) => {
  const { host, username, password, action, stream_id, type } = req.query;
  
  if (!host || !username || !password) {
    return res.status(400).send('Missing Xtream parameters (host, username, password required)');
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

// Root check endpoint
app.get('/', (req, res) => {
  res.send('IPTV Proxy Server is operational on proxy.kurdsport.online');
});

module.exports = app;
