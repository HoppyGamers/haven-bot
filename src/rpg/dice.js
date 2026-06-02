// ---------------------------------------------------------------------------
// src/rpg/dice.js
//
// Dice rolling engine — parses and evaluates any dice notation.
// Supports: 1d20, 2d6+3, 4d6kh3 (keep highest), d20 (implicit 1), etc.
// ---------------------------------------------------------------------------

/**
 * Roll a single die with N sides.
 */
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parse and roll a dice expression.
 * Returns { expression, rolls, modifier, total, breakdown }
 *
 * Supported formats:
 *   d20          → 1d20
 *   1d20         → standard roll
 *   2d6+3        → roll 2d6 and add 3
 *   4d6kh3       → roll 4d6 keep highest 3
 *   4d6kl3       → roll 4d6 keep lowest 3
 *   1d20-2       → roll with negative modifier
 *   adv          → 2d20 keep highest (advantage)
 *   dis          → 2d20 keep lowest (disadvantage)
 */
function roll(expression) {
  const expr = expression.trim().toLowerCase();

  // Advantage / Disadvantage shortcuts
  if (expr === 'adv' || expr === 'advantage') {
    const r1 = rollDie(20);
    const r2 = rollDie(20);
    const total = Math.max(r1, r2);
    return {
      expression: 'Advantage (2d20kh1)',
      rolls: [r1, r2],
      kept: [total],
      modifier: 0,
      total,
      breakdown: `[${r1}, ${r2}] → kept ${total}`,
    };
  }

  if (expr === 'dis' || expr === 'disadvantage') {
    const r1 = rollDie(20);
    const r2 = rollDie(20);
    const total = Math.min(r1, r2);
    return {
      expression: 'Disadvantage (2d20kl1)',
      rolls: [r1, r2],
      kept: [total],
      modifier: 0,
      total,
      breakdown: `[${r1}, ${r2}] → kept ${total}`,
    };
  }

  // Main dice parser
  // Format: [N]d[SIDES][kh|kl][KEEP][+/-MOD]
  const match = expr.match(/^(\d+)?d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?$/);
  if (!match) {
    return { error: `Cannot parse dice expression: "${expression}"` };
  }

  const count    = parseInt(match[1] || '1');
  const sides    = parseInt(match[2]);
  const keepType = match[3] || null;  // 'kh' or 'kl'
  const keepN    = match[4] ? parseInt(match[4]) : null;
  const modifier = match[5] ? parseInt(match[5]) : 0;

  if (count < 1 || count > 100) return { error: 'Dice count must be between 1 and 100' };
  if (sides < 2 || sides > 1000) return { error: 'Dice sides must be between 2 and 1000' };

  // Roll all dice
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  let kept = [...rolls];

  // Apply keep highest/lowest
  if (keepType && keepN) {
    const sorted = [...rolls].sort((a, b) => a - b);
    if (keepType === 'kh') {
      const threshold = sorted[count - keepN];
      kept = rolls.filter((r, i) => {
        // Keep the highest N — use index tracking to handle ties
        return true;
      });
      // Simple approach: sort and slice
      kept = [...rolls].sort((a, b) => b - a).slice(0, keepN);
    } else {
      kept = [...rolls].sort((a, b) => a - b).slice(0, keepN);
    }
  }

  const diceTotal = kept.reduce((sum, r) => sum + r, 0);
  const total     = diceTotal + modifier;

  const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
  const keepStr = keepType ? ` keep ${keepType === 'kh' ? 'highest' : 'lowest'} ${keepN}` : '';

  return {
    expression: `${count}d${sides}${keepType ? keepType + keepN : ''}${modStr}`,
    rolls,
    kept: kept.length !== rolls.length ? kept : null,
    modifier,
    total,
    breakdown: rolls.length > 1
      ? `[${rolls.join(', ')}]${kept.length !== rolls.length ? ` → kept [${kept.join(', ')}]` : ''}${modStr} = **${total}**`
      : `[${rolls[0]}]${modStr} = **${total}**`,
  };
}

/**
 * Roll multiple dice expressions at once.
 * e.g. rollMultiple(['1d20', '1d8+3']) for attack + damage
 */
function rollMultiple(expressions) {
  return expressions.map(e => ({ ...roll(e), expression: e }));
}

/**
 * Format a roll result for display in Haven.
 */
function formatRoll(result, label = null) {
  if (result.error) return `❌ ${result.error}`;
  const labelStr = label ? `**${label}:** ` : '';
  return `🎲 ${labelStr}${result.expression} → ${result.breakdown}`;
}

/**
 * Get the D&D 5e ability modifier for a stat value.
 */
function abilityMod(score) {
  return Math.floor((score - 10) / 2);
}

/**
 * Format an ability modifier for display (+2, -1, etc.)
 */
function formatMod(score) {
  const mod = abilityMod(score);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/**
 * Roll 4d6 drop lowest for character creation.
 */
function rollStat() {
  const rolls = Array.from({ length: 4 }, () => rollDie(6));
  const sorted = [...rolls].sort((a, b) => a - b);
  const kept = sorted.slice(1); // drop lowest
  return {
    rolls,
    kept,
    total: kept.reduce((s, r) => s + r, 0),
  };
}

/**
 * Roll a full set of 6 ability scores.
 */
function rollCharacterStats() {
  const stats = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  return stats.reduce((acc, stat) => {
    const r = rollStat();
    acc[stat.toLowerCase()] = r.total;
    acc[`${stat.toLowerCase()}_roll`] = r;
    return acc;
  }, {});
}

module.exports = { roll, rollMultiple, formatRoll, abilityMod, formatMod, rollStat, rollCharacterStats };
