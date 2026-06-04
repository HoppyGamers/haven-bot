// ---------------------------------------------------------------------------
// src/rpg/ascii.js
//
// ASCII art generation for RPG scene illustrations.
// Uses Ollama to generate contextual ASCII art for scenes and encounters.
// ---------------------------------------------------------------------------

const { chat } = require('../agent/ollama');

/**
 * Generate ASCII art for a scene or subject.
 * Returns the ASCII art string or null on failure.
 */
async function generateAscii(subject, ollamaUrl, model, style = 'scene') {
  const prompts = {
    scene: `Create a simple ASCII art illustration of: "${subject}"
Requirements:
- Use only ASCII characters: letters, numbers, symbols like /\\|_-.*+=#@![](){}
- Maximum 10 lines tall, 50 characters wide
- Should be recognizable and evocative
- No color codes or escape sequences
- Just the raw ASCII art, nothing else
- Make it atmospheric for a fantasy RPG`,

    monster: `Create ASCII art of a monster/creature: "${subject}"
- 6-8 lines tall, centered
- Menacing and detailed
- Use characters like /\\|*#@^><()[] for texture
- Just the art, no explanation`,

    map: `Create a simple ASCII map/dungeon layout: "${subject}"
- Use # for walls, . for floors, D for doors, T for traps, S for stairs
- 12 lines x 40 characters
- Add a simple legend below
- Just the map and legend, nothing else`,

    item: `Create small ASCII art (3-4 lines) of this item: "${subject}"
- Clean and simple
- Just the art, no text`,
  };

  const prompt = prompts[style] || prompts.scene;

  try {
    const response = await chat({
      ollamaUrl,
      model,
      systemPrompt: 'You are an ASCII artist. Create clean ASCII art exactly as requested. Output ONLY the ASCII art, nothing else.',
      messages: [{ role: 'user', content: prompt }],
    });

    if (!response || !response.trim()) return null;

    // Clean up the response — remove markdown code blocks if present
    let art = response.trim();
    art = art.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();

    return art;
  } catch (err) {
    console.warn('[RPG ASCII] Generation failed:', err.message);
    return null;
  }
}

/**
 * Format ASCII art for Haven display inside a code block.
 */
function formatAscii(art, title = null) {
  if (!art) return null;
  const header = title ? `**${title}**\n` : '';
  return `${header}\`\`\`\n${art}\n\`\`\``;
}

/**
 * Pre-made ASCII art for common RPG elements (fallback when Ollama is slow).
 */
const PREBUILT = {
  tavern: `
    ___________
   |  TAVERN   |
   |___________|
   | [] []  [] |
   |___________|
  /|           |\\
 / |  OPEN     | \\
/__|___________|__\\`.trim(),

  dungeon: `
  ####  ####
  #  ####  #
  #        #
  #  ####  #
  ## #  # ##
   # #  # #
   #      #
   ########`.trim(),

  dragon: `
      /\\                    /\\
     /  \\  /\\/\\  /\\/\\  /\\  /  \\
    / /\\ \\/ /  \\/ /  \\/ /\\ /\\ \\
   / /__\\/  /\\  /  /\\  / /__\\ \\
  /________/  \\/  /  \\/________\\
  \\   /\\/\\   /    \\   /\\/\\   /
   \\ /    \\ / (oo) \\ /    \\ /
    V      V        V      V`.trim(),

  sword: `
     |
    /|\\
   / | \\
  /  |  \\
 /   |   \\
|    |    |
 \\   |   /
  \\  |  /
   \\ | /
    \\|/
     |
    /|\\
   / | \\`.trim(),

  skull: `
   ___
  /   \\
 | o o |
  \\ ^ /
   |||||
   |||||`.trim(),
};

/**
 * Get a pre-built ASCII art by key, or null.
 */
function getPrebuilt(key) {
  return PREBUILT[key.toLowerCase()] || null;
}

module.exports = { generateAscii, formatAscii, getPrebuilt, PREBUILT };
