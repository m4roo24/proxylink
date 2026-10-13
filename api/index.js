export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get('url');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ==========================================
  // 1. IF NO URL, SHOW THE HTML VIDEO PLAYER
  // ==========================================
  if (!targetUrl) {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>KurdSport Proxy Player</title>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: white; text-align: center; padding: 20px; }
            h1 { color: #38bdf8; }
            .container { max-width: 800px; margin: 0 auto; }
            input { width: 70%; padding: 12px; border: none; border-radius: 6px; font-size: 16px; color: #333; margin-bottom: 10px; }
            button { padding: 12px 24px; background: #38bdf8; color: #0f172a; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; }
            button:hover { background: #0ea5e9; }
            video { width: 100%; margin-top: 30px; background: #000; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
            .footer { margin-top: 40px; font-size: 14px; color: #94a3b8; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>KurdSport Proxy Player</h1>
            <p>Paste an HTTP or HTTPS .m3u8 link below to test it securely</p>
            <input type="text" id="streamUrl" placeholder="http://example.com/live/stream.m3u8">
            <button onclick="playStream()">Play Stream</button>
            
            <video id="video" controls></video>
            
            <div class="footer">proxy.kurdsport.online</div>
        </div>

        <script>
            function playStream() {
                const target = document.getElementById('streamUrl').value;
                if (!target) return alert("Please enter an .m3u8 URL");
                
                // Route the video through your proxy
                const proxyUrl = window.location.origin + '/?url=' + encodeURIComponent(target);
                const video = document.getElementById('video');

                if (Hls.isSupported()) {
                    const hls = new Hls();
                    hls.loadSource(proxyUrl);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = proxyUrl;
                    video.addEventListener('loadedmetadata', () => video.play());
                }
            }
        </script>
    </body>
    </html>
    `;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // ==========================================
  // 2. PROXY LOGIC (For .m3u8 and .ts files)
  // ==========================================
  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    const reqHeaders = new Headers(req.headers);
    const fetchHeaders = new Headers();
    
    // Forward standard headers to trick the source server
    ['user-agent', 'referer', 'origin', 'accept-language'].forEach(h => {
      if (reqHeaders.has(h)) fetchHeaders.set(h, reqHeaders.get(h));
    });

    const response = await fetch(decodedUrl, { headers: fetchHeaders });

    if (!response.ok) {
      return new Response(`Error: ${response.status}`, { status: response.status, headers: corsHeaders });
    }

    const contentType = response.headers.get('content-type') || '';
    const isM3u8 = decodedUrl.includes('.m3u8') || contentType.includes('mpegurl');

    let body = response.body;

    if (isM3u8) {
      const text = await response.text();
      const baseUrl = new URL(decodedUrl);
      
      const proxiedText = text.split('\n').map(line => {
        const trimmed = line.trim();
        // Rewrite URI attributes (encryption keys)
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (match, p1) => {
            try { return `URI="${url.origin}/?url=${encodeURIComponent(new URL(p1, baseUrl.href).href)}"`; }
            catch(e) { return match; }
          });
        }
        if (trimmed.startsWith('#') || trimmed === '') return line;
        // Rewrite .ts and .m3u8 paths
        try { return `${url.origin}/?url=${encodeURIComponent(new URL(trimmed, baseUrl.href).href)}`; }
        catch (e) { return line; }
      }).join('\n');
      
      body = proxiedText;
    }

    const responseHeaders = new Headers(corsHeaders);
    if (contentType) responseHeaders.set('Content-Type', contentType);
    if (decodedUrl.includes('.ts')) responseHeaders.set('Cache-Control', 'public, max-age=31536000'); // Cache video pieces

    return new Response(body, { status: response.status, headers: responseHeaders });

  } catch (error) {
    return new Response('Proxy Error: ' + error.message, { status: 500, headers: corsHeaders });
  }
          }
