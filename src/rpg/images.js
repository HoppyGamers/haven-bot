// ---------------------------------------------------------------------------
// src/rpg/images.js
//
// Stable Diffusion image generation via ComfyUI API.
// Generates RPG scene images and returns a public HTTPS URL for Haven.
// ---------------------------------------------------------------------------

const http  = require('http');
const https = require('https');

/**
 * Generate an image via ComfyUI and return the public URL.
 *
 * @param {string} prompt       — positive prompt describing the scene
 * @param {string} [style]      — 'scene' | 'monster' | 'portrait' | 'item'
 * @returns {Promise<string|null>} — public HTTPS URL or null on failure
 */
async function generateImage(prompt, style = 'scene', campaignSeed = null) {
  const comfyUrl   = process.env.COMFYUI_URL   || 'http://192.168.50.6:8188';
  const imageBase  = process.env.IMAGE_BASE_URL || 'https://images.hoppygamers.com';
  const model      = process.env.COMFYUI_MODEL  || 'dreamshaperXL_lightningDPMSDE.safetensors';

  // Load settings from cache (refreshes every 30s)
  const s = getCachedSettings();
  if (!s.enabled) return null;
  const { width: dbWidth, height: dbHeight, steps: dbSteps, cfg: dbCfg, artStyle } = s;

  // Style-specific settings — use DB dimensions as base
  // Load art styles from DB, fall back to hardcoded defaults
  let styleDef = { prefix: '', neg: '' };
  try {
    const { artStyles } = require('./database');
    const allStyles = artStyles.getEnabled();
    const match = allStyles.find(s => s.key === artStyle);
    if (match) {
      styleDef = {
        prefix: match.prefix ? match.prefix.trim() + ' ' : '',
        neg:    match.negative ? ', ' + match.negative : '',
      };
    }
  } catch {}

  const styleConfig = {
    scene:    { width: dbWidth,                          height: dbHeight,                      cfg: dbCfg, steps: dbSteps, suffix: 'dramatic lighting, detailed environment, fantasy RPG art' },
    monster:  { width: Math.min(dbWidth, 512),           height: Math.min(dbHeight, 512),       cfg: dbCfg, steps: dbSteps, suffix: 'creature, dramatic pose, detailed' },
    portrait: { width: Math.min(dbWidth, 512),           height: Math.min(dbHeight * 1.5, 768), cfg: dbCfg, steps: dbSteps, suffix: 'character portrait, detailed face, dramatic lighting' },
    item:     { width: Math.min(dbWidth, 512),           height: Math.min(dbHeight, 512),       cfg: dbCfg, steps: dbSteps, suffix: 'fantasy item, detailed, dark background' },
  };

  const cfg        = styleConfig[style] || styleConfig.scene;
  const fullPrompt = `${styleDef.prefix}${prompt}, ${cfg.suffix}`;
  const negPrompt  = `blurry, ugly, deformed, watermark, text, low quality, nsfw${styleDef.neg}`;
  // Use campaignSeed for consistency, fallback to random
  const seed       = campaignSeed || Math.floor(Math.random() * 2147483647);
  const filename   = `rpg_${Date.now()}`;

  const workflow = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: fullPrompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negPrompt,  clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: cfg.width, height: cfg.height, batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['2', 0], negative: ['3', 0],
      latent_image: ['4', 0], seed, steps: cfg.steps,
      cfg: cfg.cfg, sampler_name: 'dpmpp_sde', scheduler: 'karras', denoise: 1.0,
    }},
    '6': { class_type: 'VAEDecode',  inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage',  inputs: { images: ['6', 0], filename_prefix: filename } },
  };

  try {
    // Submit prompt
    const submitRes = await httpPost(`${comfyUrl}/prompt`, { prompt: workflow });
    if (!submitRes.prompt_id) throw new Error('No prompt_id returned');
    const promptId = submitRes.prompt_id;

    // Poll for completion (max 120s)
    const outputFile = await pollForCompletion(comfyUrl, promptId, filename, 120000);
    if (!outputFile) return null;

    return `${imageBase}/${outputFile}`;
  } catch (err) {
    console.warn('[RPG Images] Generation failed:', err.message);
    return null;
  }
}

/**
 * Poll ComfyUI history until the prompt completes or times out.
 */
async function pollForCompletion(comfyUrl, promptId, filenamePrefix, timeoutMs) {
  const start    = Date.now();
  const interval = 2000;

  while (Date.now() - start < timeoutMs) {
    await sleep(interval);
    try {
      const history = await httpGet(`${comfyUrl}/history/${promptId}`);
      const entry   = history[promptId];
      if (!entry) continue;

      const status = entry.status?.status_str;
      if (status === 'error') {
        const errMsg = entry.status?.messages?.find(m => m[0] === 'execution_error')?.[1]?.exception_message;
        throw new Error(errMsg || 'ComfyUI execution error');
      }

      // Check for output images
      const outputs = entry.outputs;
      if (outputs) {
        for (const nodeId of Object.keys(outputs)) {
          const images = outputs[nodeId]?.images;
          if (images && images.length > 0) {
            return images[0].filename;
          }
        }
      }
    } catch (err) {
      if (err.message.includes('ComfyUI')) throw err;
      // Network error — keep polling
    }
  }

  throw new Error('Image generation timed out after ' + timeoutMs / 1000 + 's');
}

/**
 * Build a scene prompt from RPG context.
 * Finds the most visually descriptive sentence rather than just the first.
 */
function buildImagePrompt(dmText, campaignSystem = 'dnd5e') {
  const systemStyle = {
    dnd5e:     'medieval fantasy',
    starwars:  'science fiction Star Wars galaxy',
    cyberpunk: 'cyberpunk neon dystopia',
    scifi:     'science fiction space opera',
    horror:    'dark horror atmospheric',
  };

  const style = systemStyle[campaignSystem] || 'fantasy';

  // Visual location keywords — prioritize sentences that describe a place or scene
  const visualKeywords = /(shack|cabin|tavern|castle|forest|cave|dungeon|tower|bridge|river|clearing|ruins|temple|village|inn|market|alley|corridor|chamber|gate|door|building|structure|path|road|street|harbor|ship|space|planet|city|slums|rooftop)/i;

  const sentences = dmText.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 20);

  // Find first sentence with a strong visual location keyword
  const visualSentence = sentences.find(s => visualKeywords.test(s));
  const subject = (visualSentence || sentences[0] || dmText).slice(0, 120).trim();

  return `${style} scene, ${subject}, detailed, atmospheric lighting, fantasy RPG art`;
}

/**
 * Detect if a DM response warrants an image.
 * Returns { prompt, style } or null.
 */
// Track last image time per channel+style to avoid spamming
// Key: channelId:style, Value: timestamp
const lastImageTime = new Map();
// Cooldown uses cached settings
function getCooldown(style) {
  const base = getCachedSettings().cooldown || 45;
  const multipliers = { scene: 1, monster: 0.7, portrait: 1.5, item: 1.5 };
  return Math.round(base * (multipliers[style] || 1) * 1000);
}

// Compiled regex cache — rebuilt when triggers change
const regexCache = new Map();
let regexCacheTime = 0;
const REGEX_CACHE_TTL = 30000; // 30s

function getCompiledTriggers(campaignSystem) {
  const now = Date.now();
  const cacheKey = campaignSystem;
  if (regexCache.has(cacheKey) && now - regexCacheTime < REGEX_CACHE_TTL) {
    return regexCache.get(cacheKey);
  }
  try {
    const { imageTriggers } = require('./database');
    const triggers = imageTriggers.getEnabled(campaignSystem);
    const compiled = triggers.map(t => {
      try { return { ...t, regex: new RegExp(t.pattern, 'i') }; }
      catch { return null; }
    }).filter(Boolean);
    regexCache.set(cacheKey, compiled);
    regexCacheTime = now;
    return compiled;
  } catch { return []; }
}

// Settings cache — avoid hitting DB on every generation
let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 30000;

function getCachedSettings() {
  const now = Date.now();
  if (settingsCache && now - settingsCacheTime < SETTINGS_CACHE_TTL) return settingsCache;
  try {
    const { rpgSettings } = require('./database');
    settingsCache = {
      enabled:  rpgSettings.getBool('image_enabled', true),
      width:    rpgSettings.getInt('image_width',  832),
      height:   rpgSettings.getInt('image_height', 512),
      steps:    rpgSettings.getInt('image_steps',  4),
      cfg:      rpgSettings.getFloat('image_cfg',  2.0),
      artStyle: rpgSettings.get('image_art_style') || '',
      cooldown: rpgSettings.getInt('image_cooldown', 45),
    };
    settingsCacheTime = now;
  } catch {
    settingsCache = { enabled: true, width: 832, height: 512, steps: 4, cfg: 2.0, artStyle: '', cooldown: 45 };
    settingsCacheTime = now;
  }
  return settingsCache;
}

/**
 * Check DM text against DB-stored trigger patterns.
 */
function shouldGenerateImage(dmText, campaignSystem, channelId) {
  const now      = Date.now();
  const triggers = getCompiledTriggers(campaignSystem);

  for (const trigger of triggers) {
    if (trigger.regex.test(dmText)) {
      const cooldownKey = `${channelId}:${trigger.style}`;
      const last        = lastImageTime.get(cooldownKey) || 0;
      const cooldown    = getCooldown(trigger.style);
      if (now - last < cooldown) continue;

      lastImageTime.set(cooldownKey, now);
      return { prompt: buildImagePrompt(dmText, campaignSystem), style: trigger.style };
    }
  }

  return null;
}

/**
 * Check if player's action is an appearance query that should generate an image.
 * These bypass DM response analysis and trigger directly from player input.
 */
function shouldGenerateAppearanceImage(actionText, campaignSystem) {
  const text = actionText.toLowerCase();

  // Character appearance
  if (/what do (i|we|my character) look like|how do i appear|my appearance|describe.*my character/i.test(text)) {
    return { prompt: `${campaignSystem} RPG character portrait, hero adventurer`, style: 'portrait' };
  }

  // Weapon/item appearance
  if (/what does my (sword|weapon|staff|bow|wand|shield|armor|axe|dagger|spear) look like|show.*my (sword|weapon|item)/i.test(text)) {
    const itemMatch = text.match(/my (sword|weapon|staff|bow|wand|shield|armor|axe|dagger|spear)/);
    const item = itemMatch ? itemMatch[1] : 'weapon';
    return { prompt: `fantasy RPG ${item}, detailed item art, dark background`, style: 'item' };
  }

  // Drawing/equipping a weapon
  if (/i draw (my|the) (sword|weapon|blade|dagger|axe|staff|bow)|i equip|i hold (up|out) (my|the)/i.test(text)) {
    const itemMatch = text.match(/(sword|weapon|blade|dagger|axe|staff|bow)/);
    const item = itemMatch ? itemMatch[1] : 'weapon';
    return { prompt: `fantasy RPG ${item} being drawn, dramatic lighting, hero`, style: 'item' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const data    = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = lib.request(options, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req    = lib.get(url, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { generateImage, buildImagePrompt, shouldGenerateImage, shouldGenerateAppearanceImage };
