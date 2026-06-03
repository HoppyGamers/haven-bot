// ---------------------------------------------------------------------------
// src/rpg/images.js
//
// Stable Diffusion image generation via ComfyUI API.
// Generates RPG scene images and returns a public HTTPS URL for Haven.
// ---------------------------------------------------------------------------

const http  = require('http');
const https = require('https');
const path  = require('path');

/**
 * Generate an image via ComfyUI and return the public URL.
 *
 * @param {string} prompt       — positive prompt describing the scene
 * @param {string} [style]      — 'scene' | 'monster' | 'portrait' | 'item'
 * @returns {Promise<string|null>} — public HTTPS URL or null on failure
 */
async function generateImage(prompt, style = 'scene') {
  const comfyUrl   = process.env.COMFYUI_URL   || 'http://192.168.50.6:8188';
  const imageBase  = process.env.IMAGE_BASE_URL || 'https://images.hoppygamers.com';
  const model      = process.env.COMFYUI_MODEL  || 'dreamshaperXL_lightningDPMSDE.safetensors';

  // Style-specific settings
  const styleConfig = {
    scene:    { width: 832, height: 512, cfg: 2.0, steps: 4, suffix: 'dramatic lighting, detailed environment, fantasy RPG art style' },
    monster:  { width: 512, height: 512, cfg: 2.0, steps: 4, suffix: 'fantasy creature, dramatic pose, detailed, RPG monster art' },
    portrait: { width: 512, height: 768, cfg: 2.0, steps: 4, suffix: 'character portrait, fantasy RPG, detailed face, dramatic lighting' },
    item:     { width: 512, height: 512, cfg: 2.0, steps: 4, suffix: 'fantasy item, detailed, dark background, RPG loot art style' },
  };

  const cfg = styleConfig[style] || styleConfig.scene;
  const fullPrompt = `${prompt}, ${cfg.suffix}`;
  const negPrompt  = 'blurry, ugly, deformed, watermark, text, low quality, nsfw';
  const seed       = Math.floor(Math.random() * 2147483647);
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

  // Extract subject from DM text — first sentence, max 100 chars
  const subject = dmText.split(/[.!?]/)[0].slice(0, 100).trim();

  return `${style} scene, ${subject}`;
}

/**
 * Detect if a DM response warrants an image.
 * Returns { prompt, style } or null.
 */
function shouldGenerateImage(dmText, campaignSystem) {
  const text = dmText.toLowerCase();

  // New location
  if (/you enter|you step into|you arrive|before you (stands?|lies?|looms?)|you find yourself/i.test(dmText)) {
    return { prompt: buildImagePrompt(dmText, campaignSystem), style: 'scene' };
  }

  // Monster/enemy appears
  if (/emerges?|appears?|bursts? (from|through)|lunges?|charges?|snarls?|roars?/i.test(text)) {
    return { prompt: buildImagePrompt(dmText, campaignSystem), style: 'monster' };
  }

  // Combat starts
  if (/initiative|roll for attack|combat begins|battle starts/i.test(text)) {
    return { prompt: buildImagePrompt(dmText, campaignSystem), style: 'scene' };
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

module.exports = { generateImage, buildImagePrompt, shouldGenerateImage };
