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
 * 1. General HTTP/HTTPS, .m3u8 Playlists, and .ts Segment Proxy Route
 */
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter (?url=...)');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const isM3U8 = targetUrl.includes('.m3u8') || req.query.type === 'm3u8';
    const isTS = targetUrl.includes('.ts') || req.query.type === 'ts';

    if (isM3U8) {
      // Fetch the M3U8 playlist as text
      const response = await axios.get(targetUrl, {
        responseType: 'text',
        headers: { 
          'User-Agent': req.headers['user-agent'] || 'VLC/3.0.16 LibVLC/3.0.16' 
        }
      });

      const playlist = response.data;
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1)}`;

      // Rewrite playlist lines to route every segment (.ts, .m4s) back through this proxy
      const lines = playlist.split('\n');
      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line; // Keep comments and tags intact
        }

        // Convert relative segment links to absolute URLs
        let absoluteSegmentUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          absoluteSegmentUrl = new URL(trimmed, baseUrl).toString();
        }

        // Redirect segment back to this proxy using dynamic host detection
        const currentHost = req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        return `${protocol}://${currentHost}/proxy?url=${encodeURIComponent(absoluteSegmentUrl)}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewrittenLines.join('\n'));
    } else {
      // Direct stream handling for .ts segments, mp4, or direct media files
      const response = await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        headers: { 
          'User-Agent': req.headers['user-agent'] || 'VLC/3.0.16 LibVLC/3.0.16' 
        }
      });

      // Set proper video headers for .ts segments
      const contentType = isTS ? 'video/mp2t' : (response.headers['content-type'] || 'video/mp2t');

      res.writeHead(response.status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      // Stream binary chunks directly without loading into server memory
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
 * 2. Xtream Codes API & Stream Handler
 */
app.get('/xtream', async (req, res) => {
  const { host, username, password, action, stream_id, type } = req.query;
  
  if (!host || !username || !password) {
    return res.status(400).send('Missing Xtream parameters (host, username, password required)');
  }

  const cleanHost = host.endsWith('/') ? host.slice(0, -1) : host;
  const currentHost = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';

  // Redirect live stream request (.ts) through our proxy
  if (action === 'live' && stream_id) {
    const streamUrl = `${cleanHost}/live/${username}/${password}/${stream_id}.ts`;
    return res.redirect(`${protocol}://${currentHost}/proxy?url=${encodeURIComponent(streamUrl)}`);
  } 
  
  // Redirect VOD movies or series through our proxy
  if ((action === 'movie' || action === 'series') && stream_id) {
    const ext = req.query.ext || 'mp4';
    const streamUrl = `${cleanHost}/${action}/${username}/${password}/${stream_id}.${ext}`;
    return res.redirect(`${protocol}://${currentHost}/proxy?url=${encodeURIComponent(streamUrl)}`);
  } 

  // Proxy Xtream JSON metadata API (categories, stream list, user info)
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

// Default root response
app.get('/', (req, res) => {
  res.send('IPTV Proxy Server is operational on proxy.kurdsport.online');
});

module.exports = app;
