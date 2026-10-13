const axios = require('axios');

export default async function handler(req, res) {
    // Enable CORS for all domains
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle Preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Error: Missing "url" query parameter.');
    }

    try {
        const isM3u8 = targetUrl.includes('.m3u8');

        // Fetch the stream
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: isM3u8 ? 'text' : 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        });

        // Forward the content type
        const contentType = response.headers['content-type'];
        if (contentType) res.setHeader('Content-Type', contentType);

        if (isM3u8) {
            let m3u8Content = response.data;
            
            // Get the current domain dynamically (proxy.kurdsport.online)
            const host = req.headers['x-forwarded-host'] || req.headers.host;
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const proxyHost = `${protocol}://${host}/proxy?url=`;

            const rewriteUrl = (originalUrl) => {
                try {
                    const absoluteUrl = new URL(originalUrl, targetUrl).href;
                    return proxyHost + encodeURIComponent(absoluteUrl);
                } catch (e) {
                    return originalUrl;
                }
            };

            // Rewrite playlist links and .ts files
            m3u8Content = m3u8Content.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    return rewriteUrl(trimmed);
                }
                return line;
            }).join('\n');

            // Rewrite AES Encryption key URLs if present
            m3u8Content = m3u8Content.replace(/URI="([^"]+)"/g, (match, p1) => {
                return `URI="${rewriteUrl(p1)}"`;
            });

            res.status(200).send(m3u8Content);
        } else {
            // Stream binary data (.ts video segments) directly to bypass RAM limits
            response.data.pipe(res);
        }
    } catch (error) {
        console.error(`Error fetching: ${targetUrl}`, error.message);
        res.status(500).send('Error loading the stream.');
    }
              }
