// ---------------------------------------------------------------------------
// src/agent/ollama.js
//
// Handles communication with the Ollama API.
// Sends conversation history + system prompt and returns the model's response.
// ---------------------------------------------------------------------------

const https = require('https');
const http  = require('http');

/**
 * Send a conversation to Ollama and return the assistant's response text.
 *
 * @param {object} params
 * @param {string} params.ollamaUrl  - Base URL e.g. http://192.168.50.6:11434
 * @param {string} params.model      - Model name e.g. qwen2.5:7b
 * @param {string} params.systemPrompt - System prompt defining agent persona
 * @param {Array}  params.messages   - Conversation history [{role, content}]
 * @returns {Promise<string>} - The assistant's response text
 */
async function chat({ ollamaUrl, model, systemPrompt, messages }) {
  const url = new URL('/api/chat', ollamaUrl);

  const body = JSON.stringify({
    model,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    options: {
      temperature: 0.7,
      num_predict: 500,  // Keep responses concise for chat
    },
  });

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Ollama error: ${parsed.error}`));
          } else {
            resolve(parsed.message?.content || '');
          }
        } catch (err) {
          reject(new Error(`Failed to parse Ollama response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Ollama request timed out after 30s'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Check if Ollama is reachable and the configured model is available.
 * Returns { ok: true } or { ok: false, error: string }
 */
async function healthCheck(ollamaUrl, model) {
  try {
    const url = new URL('/api/tags', ollamaUrl);

    const result = await new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.toString(), (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    });

    const models = result.models || [];
    const found  = models.some(m => m.name === model || m.name.startsWith(model.split(':')[0]));

    if (!found) {
      const available = models.map(m => m.name).join(', ') || 'none';
      return { ok: false, error: `Model '${model}' not found. Available: ${available}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Cannot reach Ollama at ${ollamaUrl}: ${err.message}` };
  }
}

module.exports = { chat, healthCheck };
