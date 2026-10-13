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
 * Universal Proxy Route with Proper Referer/Origin Spoofing for .ts and .m3u8
 */
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing target URL parameter (?url=...)');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const targetOrigin = `${parsedUrl.protocol}//${parsedUrl.host}`;
    
    // Custom headers to bypass anti-hotlinking on upstream servers
    const upstreamHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': targetOrigin + '/',
      'Origin': targetOrigin
    };

    const isExplicitM3U8 = targetUrl.includes('.m3u8') || req.query.type === 'm3u8';

    if (isExplicitM3U8) {
      return await handleM3U8(targetUrl, parsedUrl, upstreamHeaders, req, res);
    }

    // Check content type for extensionless token streams
    const headResponse = await axios.head(targetUrl, {
      headers: upstreamHeaders,
      validateStatus: () => true
    });

    const contentType = headResponse.headers['content-type'] || '';
    const isPlaylistContent = contentType.includes('mpegurl') || contentType.includes('application/vnd.apple.mpegurl');

    if (isPlaylistContent) {
      return await handleM3U8(targetUrl, parsedUrl, upstreamHeaders, req, res);
    } else {
      // Stream binary data (.ts segments, etc.) with correct upstream headers
      const response = await axios({
        method: 'get',
        url: targetUrl,
        responseType: 'stream',
        headers: upstreamHeaders
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

async function handleM3U8(targetUrl, parsedUrl, upstreamHeaders, req, res) {
  const response = await axios.get(targetUrl, {
    responseType: 'text',
    headers: upstreamHeaders
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

app.get('/', (req, res) => {
  res.send('IPTV Proxy Server is operational on proxy.kurdsport.online');
});

module.exports = app;
