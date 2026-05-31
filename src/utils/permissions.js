const { admins, bans } = require('../database');

/**
 * Check if a user is an admin/moderator
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user is admin
 */
function isAdmin(userId) {
  return admins.isAdmin(userId);
}

/**
 * Check if a user is banned
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user is banned
 */
function isBanned(userId) {
  return bans.isBanned(userId);
}

/**
 * Require admin permission for a command
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if admin, false if not
 */
function requireAdmin(userId) {
  return isAdmin(userId);
}

/**
 * Get ban details for a user
 * @param {string} userId - The user ID
 * @returns {object|null} Ban details or null if not banned
 */
function getBanDetails(userId) {
  return bans.getBan(userId);
}

module.exports = {
  isAdmin,
  isBanned,
  requireAdmin,
  getBanDetails,
};
