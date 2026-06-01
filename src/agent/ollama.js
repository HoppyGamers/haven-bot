// ---------------------------------------------------------------------------
// src/agent/ollama.js
//
// Handles communication with the Ollama API.
// Supports both plain chat and native tool/function calling.
// ---------------------------------------------------------------------------

const https = require('https');
const http  = require('http');

/**
 * Make a raw request to the Ollama /api/chat endpoint.
 */
async function ollamaRequest(ollamaUrl, body) {
  const url = new URL('/api/chat', ollamaUrl);

  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(`Ollama error: ${parsed.error}`));
          else resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse Ollama response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Ollama request timed out after 60s')));
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Plain chat — no tools. Returns response text.
 */
async function chat({ ollamaUrl, model, systemPrompt, messages }) {
  const result = await ollamaRequest(ollamaUrl, {
    model,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    options: { temperature: 0.7, num_predict: 600 },
  });

  return result.message?.content || '';
}

/**
 * Chat with native tool calling support.
 * Returns { content, toolCalls } where toolCalls is an array of
 * { name, arguments } objects if the model wants to call tools.
 */
async function chatWithTools({ ollamaUrl, model, systemPrompt, messages, tools }) {
  // Convert our tool definitions to Ollama's format
  const ollamaTools = tools.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  {
        type:       'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters || {}).map(([k, v]) => [k, {
            type:        v.type || 'string',
            description: v.description || '',
          }])
        ),
        required: Object.entries(t.parameters || {})
          .filter(([, v]) => v.required)
          .map(([k]) => k),
      },
    },
  }));

  const result = await ollamaRequest(ollamaUrl, {
    model,
    stream: false,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    tools:   ollamaTools.length > 0 ? ollamaTools : undefined,
    options: { temperature: 0.7, num_predict: 600 },
  });

  const message   = result.message || {};
  const content   = message.content || '';
  const toolCalls = (message.tool_calls || []).map(tc => ({
    name:      tc.function?.name || tc.name,
    arguments: tc.function?.arguments || tc.arguments || {},
  }));

  return { content, toolCalls };
}

/**
 * Check if Ollama is reachable and the configured model is available.
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
    const found  = models.some(m =>
      m.name === model || m.name.startsWith(model.split(':')[0])
    );

    if (!found) {
      const available = models.map(m => m.name).join(', ') || 'none';
      return { ok: false, error: `Model '${model}' not found. Available: ${available}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Cannot reach Ollama at ${ollamaUrl}: ${err.message}` };
  }
}

module.exports = { chat, chatWithTools, healthCheck };
