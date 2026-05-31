const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');
const { initializeDatabase, users, stats, channels } = require('./database');
const channelManager = require('./channels');

class HavenBot extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.serverUrl = config.serverUrl || process.env.HAVEN_SERVER_URL;
    this.token = config.token || process.env.WEBHOOK_TOKEN;
    this.callbackUrl = config.callbackUrl || process.env.CALLBACK_URL || null;
    this.callbackSecret = config.callbackSecret || process.env.CALLBACK_SECRET || null;
    this.botName = config.botName || process.env.BOT_NAME || 'HavenBot';
    this.botAvatar = config.botAvatar || process.env.BOT_AVATAR_URL || null;
    this.debug = (process.env.DEBUG || 'false').toLowerCase() === 'true';
    this.channelManager = channelManager;
    
    this.rateLimitQueue = [];
    this.rateLimitInterval = null;
    this.requestCount = 0;
    this.rateLimitWindow = 60000; // 1 minute window
    this.maxRequestsPerMinute = 30;
    
    this.commands = {};
    
    this._startRateLimitReset();
  }
  
  // --- Logging ---
  
  _log(...args) {
    if (this.debug) {
      console.log(`[HavenBot]`, ...args);
    }
  }
  
  // --- HTTP Request Helper ---
  
  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      
      const options = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
        },
        timeout: 10000,
      };
      
      const req = lib.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          this._log(`${method} ${path} → ${res.statusCode}`);
          
          if (res.statusCode === 429) {
            // Rate limited — queue the request
            this._queueRequest(method, path, body);
            return;
          }
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
  
  // --- Rate Limiting ---
  
  _startRateLimitReset() {
    this.rateLimitInterval = setInterval(() => {
      this.requestCount = 0;
      this._log('Rate limit window reset');
      this._processQueue();
    }, this.rateLimitWindow);
  }
  
  _checkRateLimit() {
    if (this.requestCount >= this.maxRequestsPerMinute) {
      return false;
    }
    this.requestCount++;
    return true;
  }
  
  _queueRequest(method, path, body) {
    this.rateLimitQueue.push({ method, path, body });
    this._log(`Rate limited — queued request (${this.rateLimitQueue.length} in queue)`);
  }
  
  _processQueue() {
    if (this.rateLimitQueue.length === 0) return;
    
    const item = this.rateLimitQueue.shift();
    this._request(item.method, item.path, item.body)
      .then((res) => {
        this._log('Queued request completed');
      })
      .catch((err) => {
        this._log('Queued request failed:', err.message);
      });
    
    if (this.rateLimitQueue.length > 0) {
      setTimeout(() => this._processQueue(), 2000);
    }
  }
  
  // --- Rate-limited request wrapper ---
  
  async _safeRequest(method, path, body = null) {
    if (!this._checkRateLimit()) {
      this._log('Rate limited — queuing request');
      return new Promise((resolve, reject) => {
        this.rateLimitQueue.push({ method, path, body, resolve, reject });
      });
    }
    
    try {
      return await this._request(method, path, body);
    } catch (err) {
      if (err.message.includes('429') || err.message.includes('Rate limit')) {
        this._queueRequest(method, path, body);
      }
      throw err;
    }
  }
  
  // --- Message Methods ---
  
  async sendMessage(content, channelCode = null, options = {}) {
    if (!content || typeof content !== 'string') {
      throw new Error('Content is required and must be a string');
    }

    if (content.length > 4000) {
      // Truncate gracefully rather than throwing
      content = content.slice(0, 3997) + '...';
    }

    // Use channel-specific token if provided, otherwise primary token
    const token = channelCode
      ? this.channelManager.getToken(channelCode)
      : this.token;

    if (!token) {
      console.error(`[sendMessage] No token found for channelCode: ${channelCode}`);
      throw new Error(`No token for channel ${channelCode}`);
    }

    const body = { content };
    if (options.username)   body.username   = options.username;
    if (options.avatar_url) body.avatar_url = options.avatar_url;

    const res = await this._safeRequest('POST', `/api/webhooks/${token}/`, body);
    this._log('Message sent:', res);
    return res;
  }
  
  async deleteMessage(messageId, channelCode = null) {
    const token = channelCode ? this.channelManager.getToken(channelCode) : this.token;
    const res = await this._safeRequest('DELETE', `/api/webhooks/${token}/messages/${messageId}`);
    this._log('Message deleted:', messageId);
    return res;
  }
  
  // --- Soundboard Methods ---
  
  async playSound(soundName, channelCode = null) {
    if (!soundName) {
      throw new Error('Sound name is required');
    }
    const token = channelCode ? this.channelManager.getToken(channelCode) : this.token;
    const res = await this._safeRequest('POST', `/api/webhooks/${token}/sounds`, {
      sound: soundName,
    });
    this._log('Sound played:', soundName);
    return res;
  }
  
  async getSounds() {
    const res = await this._safeRequest('GET', '/api/sounds');
    this._log('Available sounds:', res);
    return res;
  }
  
  // --- Slash Command Methods ---
  
  async registerCommand(command, description, token = null) {
    if (!command || !description) {
      throw new Error('Command name and description are required');
    }
    const useToken = token || this.token;
    const res = await this._safeRequest('POST', `/api/webhooks/${useToken}/commands`, {
      command,
      description,
    });
    this._log('Command registered:', command);
    this.commands[command] = description;
    return res;
  }
  
  async unregisterCommand(command) {
    const res = await this._safeRequest('DELETE', `/api/webhooks/${this.token}/commands/${command}`);
    this._log('Command unregistered:', command);
    delete this.commands[command];
    return res;
  }
  
  async listCommands() {
    const res = await this._safeRequest('GET', `/api/webhooks/${this.token}/commands`);
    this._log('Registered commands:', res);
    return res;
  }
  
  // --- HMAC Verification ---
  
  verifySignature(payload, signature) {
    if (!this.callbackSecret) {
      this._log('No callback secret configured — skipping signature verification');
      return true;
    }
    
    const expected = crypto
      .createHmac('sha256', this.callbackSecret)
      .update(payload)
      .digest('hex');
    
    const valid = crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature, 'hex')
    );
    
    this._log('Signature valid:', valid);
    return valid;
  }
  
  // --- Callback Server ---
  
  createCallbackServer(port = process.env.PORT || 3000) {
    const server = http.createServer(async (req, res) => {
      // Health check endpoint
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
      }

      // Extract token from path if using per-channel callback URLs
      // Path: /cb/<n> → look up token by index
      // Path: /       → legacy single-token mode
      const urlParts = req.url.split('/').filter(Boolean);
      let pathToken = null;
      if (urlParts[0] === 'cb' && urlParts[1]) {
        const idx = parseInt(urlParts[1]);
        pathToken = !isNaN(idx)
          ? this.channelManager.getTokenByIndex(idx)
          : urlParts[1]; // fallback: treat as literal token
      }
      
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const signature = req.headers['x-haven-signature'];
          
          this._log('Raw callback payload:', JSON.stringify(data));
          
          // Verify HMAC signature
          if (signature && this.callbackSecret) {
            if (!this.verifySignature(body, signature)) {
              this._log('Invalid signature — rejecting callback');
              res.writeHead(401);
              res.end('Unauthorized');
              return;
            }
          }
          
          // Handle slash_command events (registered slash commands)
          if (data.event === 'slash_command' && data.command) {
            const command = data.command;
            const user    = data.author?.username || 'Unknown';
            const userId  = data.author?.id;

            // Use per-token path if available (/cb/<token>), else fall back to primary
            const reqToken = pathToken || this.token;

            // Register channel→token association on first sight
            if (data.channelCode && reqToken) {
              this.channelManager.registerChannel(data.channelCode, reqToken);
            }

            // Haven sends args as a space-separated string — split into array
            const argsRaw = (data.args || '').trim();
            const args    = argsRaw ? argsRaw.split(/\s+/) : [];

            const commandData = {
              command,
              user,
              user_id:      userId,
              channel_id:   data.channelCode,
              channel_name: this.channelManager.getChannelName(data.channelCode),
              timestamp:    data.timestamp || new Date().toISOString(),
              args,
              raw_content:  `/${command}${argsRaw ? ' ' + argsRaw : ''}`,
            };

            this._log('Command received:', commandData);
            this.emit('command', commandData);
            // All command routing handled by index.js via the 'command' event
          }

          // Also handle legacy message events with slash commands (fallback)
          if (data.event === 'message' && data.message && data.message.content?.startsWith('/')) {
            const parts   = data.message.content.slice(1).split(/\s+/);
            const command = parts[0];
            const user    = data.message.author.username;
            const userId  = data.message.author.id;
            const args    = parts.slice(1);

            const commandData = {
              command,
              user,
              user_id:     userId,
              channel_id:  data.channelId,
              timestamp:   data.timestamp,
              message_id:  data.message.id,
              args,
              raw_content: data.message.content,
            };

            // Register channel association for legacy events too
            // reqToken not available here — channel already pre-registered from env
            // so no action needed
            this._log('Command received (legacy):', commandData);
            this.emit('command', commandData);
            // All command routing handled by index.js via the 'command' event
          }
          
          // Send success response
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          this._log('Error processing callback:', err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });
    
    return new Promise((resolve, reject) => {
      server.listen(port, () => {
        console.log(`Callback server listening on port ${port}`);
        resolve(server);
      });
      server.on('error', reject);
    });
  }
  
  // --- Command Handlers ---
  // All command routing lives in index.js via the 'command' event.
  // This method stub is kept for backward compatibility only.
  _getCommandHandler(command) {
    const handlers = {
      ping: async (data) => {
        await this.sendMessage(`🏓 Pong! ${data.user} just pinged me!`);
      },
    };
    return handlers[command] || null;
  }
  
  // --- Initialization ---
  
  async init() {
    const allTokens = this.channelManager.getAllTokens();
    console.log('🤖 Haven Bot initializing...');
    console.log(`   Server: ${this.serverUrl}`);
    console.log(`   Bot name: ${this.botName}`);
    console.log(`   Callback: ${this.callbackUrl || 'none'}`);
    console.log(`   Channels: ${allTokens.length} (${allTokens.map(t => t.channelName).join(', ')})`);
    console.log(`   Debug: ${this.debug ? 'enabled' : 'disabled'}`);
    
    // index.js owns all command routing; bot.js only tracks ping internally
    this.commands['ping'] = 'Built-in: ping';
    
    // Initialize database
    initializeDatabase();
    console.log('✅ Haven Bot initialized');
    
    // Load profile commands (moderation is routed directly in index.js)
    this.advancedCommands = {
      ...require('./commands/profiles'),
    };
    
    // Start callback server if configured
    if (this.callbackUrl) {
      try {
        const port = parseInt(process.env.PORT || '3000', 10);
        await this.createCallbackServer(port);
      } catch (err) {
        console.error('❌ Failed to start callback server:', err.message);
      }
    } else {
      // Keep the process alive even without a callback server
      console.log('ℹ️  No callback URL configured — bot will run in message-only mode');
      // Keep process alive by preventing it from exiting
      setInterval(() => {}, 60000);
    }
    
    return this;
  }
  
  // --- Cleanup ---

  destroy() {
    if (this.rateLimitInterval) {
      clearInterval(this.rateLimitInterval);
    }
    this.emit('disconnect');
  }
}

module.exports = HavenBot;
