/**
 * Currency Helper - Database operations for the Money economy system
 *
 * Manages three tables:
 *   - users_currency   : per-user Money balance + daily cooldown
 *   - shop_items       : admin-created purchasable items
 *   - user_inventory   : items owned by users
 *
 * All queries run directly against the PostgreSQL pool so they work
 * regardless of whether the key-value wrapper is in degraded mode.
 */

import { pgDb } from './postgresDatabase.js';
import { logger } from './logger.js';

// ─── Schema bootstrap ────────────────────────────────────────────────────────

/** Set to true once the DDL has been run successfully this process lifetime. */
let tablesEnsured = false;

/**
 * Create the three currency tables if they do not already exist.
 * Idempotent — safe to call on every command invocation; DDL only runs once
 * per process lifetime after a successful setup.
 */
export async function ensureCurrencyTables() {
    if (tablesEnsured) return true;
    if (!pgDb.isAvailable()) {
        logger.warn('[CURRENCY] PostgreSQL not available – skipping table creation');
        return false;
    }

    const pool = pgDb.pool;

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users_currency (
                user_id     VARCHAR(20) PRIMARY KEY,
                money       INTEGER     NOT NULL DEFAULT 0,
                last_daily  TIMESTAMP,
                created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS shop_items (
                id          SERIAL      PRIMARY KEY,
                name        VARCHAR(100) NOT NULL UNIQUE,
                description TEXT        NOT NULL,
                price       INTEGER     NOT NULL,
                emoji       VARCHAR(10),
                created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_inventory (
                user_id      VARCHAR(20) NOT NULL,
                item_id      INTEGER     NOT NULL,
                quantity     INTEGER     NOT NULL DEFAULT 1,
                purchased_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, item_id),
                FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE CASCADE
            )
        `);

        // updated_at trigger for users_currency
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_users_currency_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);

        await pool.query(`DROP TRIGGER IF EXISTS trg_users_currency_updated_at ON users_currency`);
        await pool.query(`
            CREATE TRIGGER trg_users_currency_updated_at
            BEFORE UPDATE ON users_currency
            FOR EACH ROW EXECUTE FUNCTION update_users_currency_updated_at()
        `);

        // updated_at trigger for shop_items
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_shop_items_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);

        await pool.query(`DROP TRIGGER IF EXISTS trg_shop_items_updated_at ON shop_items`);
        await pool.query(`
            CREATE TRIGGER trg_shop_items_updated_at
            BEFORE UPDATE ON shop_items
            FOR EACH ROW EXECUTE FUNCTION update_shop_items_updated_at()
        `);

        logger.info('[CURRENCY] Currency tables created/verified');
        tablesEnsured = true;
        return true;
    } catch (error) {
        logger.error('[CURRENCY] Failed to create currency tables:', error);
        return false;
    }
}

// ─── Internal pool accessor ───────────────────────────────────────────────────

/**
 * Returns the active PostgreSQL pool or throws if unavailable.
 * @returns {import('pg').Pool}
 */
function getPool() {
    if (!pgDb.isAvailable() || !pgDb.pool) {
        throw new Error('PostgreSQL is not available. Currency commands require a database connection.');
    }
    return pgDb.pool;
}

// ─── users_currency helpers ───────────────────────────────────────────────────

/**
 * Fetch a user's currency row, creating it with 0 balance if absent.
 * @param {string} userId
 * @returns {Promise<{user_id: string, money: number, last_daily: Date|null}>}
 */
export async function getUserCurrency(userId) {
    const pool = getPool();

    // Upsert so we always get a row back
    const result = await pool.query(
        `INSERT INTO users_currency (user_id, money)
         VALUES ($1, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
    );

    const row = await pool.query(
        `SELECT user_id, money, last_daily FROM users_currency WHERE user_id = $1`,
        [userId]
    );

    return row.rows[0];
}

/**
 * Set a user's Money balance directly (no delta – absolute value).
 * @param {string} userId
 * @param {number} newBalance
 */
export async function setUserMoney(userId, newBalance) {
    const pool = getPool();
    await pool.query(
        `INSERT INTO users_currency (user_id, money)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET money = $2`,
        [userId, newBalance]
    );
}

/**
 * Update last_daily timestamp to now.
 * @param {string} userId
 */
export async function setLastDaily(userId) {
    const pool = getPool();
    await pool.query(
        `INSERT INTO users_currency (user_id, last_daily)
         VALUES ($1, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET last_daily = CURRENT_TIMESTAMP`,
        [userId]
    );
}

/**
 * Atomically add Money to a user (creates row if needed).
 * @param {string} userId
 * @param {number} amount  Must be positive.
 * @returns {Promise<number>} New balance
 */
export async function addMoneyCurrency(userId, amount) {
    const pool = getPool();
    const result = await pool.query(
        `INSERT INTO users_currency (user_id, money)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET money = users_currency.money + $2
         RETURNING money`,
        [userId, amount]
    );
    return result.rows[0].money;
}

/**
 * Atomically remove Money from a user.
 * Throws if the resulting balance would go negative.
 * @param {string} userId
 * @param {number} amount  Must be positive.
 * @returns {Promise<number>} New balance
 */
export async function removeMoneyCurrency(userId, amount) {
    const pool = getPool();

    // Ensure row exists first
    await pool.query(
        `INSERT INTO users_currency (user_id, money) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [userId]
    );

    const result = await pool.query(
        `UPDATE users_currency
         SET money = money - $2
         WHERE user_id = $1 AND money >= $2
         RETURNING money`,
        [userId, amount]
    );

    if (result.rows.length === 0) {
        throw new Error('INSUFFICIENT_FUNDS');
    }

    return result.rows[0].money;
}

/**
 * Transfer Money between two users atomically (sequential updates with rollback).
 * @param {string} fromUserId
 * @param {string} toUserId
 * @param {number} amount
 * @returns {Promise<{fromBalance: number, toBalance: number}>}
 */
export async function transferMoneyCurrency(fromUserId, toUserId, amount) {
    const pool = getPool();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Ensure both rows exist
        await client.query(
            `INSERT INTO users_currency (user_id, money) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
            [fromUserId]
        );
        await client.query(
            `INSERT INTO users_currency (user_id, money) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
            [toUserId]
        );

        // Deduct from sender
        const deductResult = await client.query(
            `UPDATE users_currency
             SET money = money - $2
             WHERE user_id = $1 AND money >= $2
             RETURNING money`,
            [fromUserId, amount]
        );

        if (deductResult.rows.length === 0) {
            await client.query('ROLLBACK');
            throw new Error('INSUFFICIENT_FUNDS');
        }

        // Credit receiver
        const creditResult = await client.query(
            `UPDATE users_currency
             SET money = money + $2
             WHERE user_id = $1
             RETURNING money`,
            [toUserId, amount]
        );

        await client.query('COMMIT');

        return {
            fromBalance: deductResult.rows[0].money,
            toBalance: creditResult.rows[0].money,
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get the top N users by Money balance.
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array<{user_id: string, money: number}>>}
 */
export async function getLeaderboard(limit = 10, offset = 0) {
    const pool = getPool();
    const result = await pool.query(
        `SELECT user_id, money
         FROM users_currency
         ORDER BY money DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    return result.rows;
}

/**
 * Count total users with a currency row.
 * @returns {Promise<number>}
 */
export async function getTotalUsers() {
    const pool = getPool();
    const result = await pool.query(`SELECT COUNT(*) AS total FROM users_currency`);
    return parseInt(result.rows[0].total, 10);
}

// ─── shop_items helpers ───────────────────────────────────────────────────────

/**
 * Fetch all shop items ordered by price ascending.
 * @returns {Promise<Array>}
 */
export async function getAllShopItems() {
    const pool = getPool();
    const result = await pool.query(
        `SELECT id, name, description, price, emoji FROM shop_items ORDER BY price ASC`
    );
    return result.rows;
}

/**
 * Fetch a single shop item by name (case-insensitive).
 * @param {string} name
 * @returns {Promise<Object|null>}
 */
export async function getShopItemByName(name) {
    const pool = getPool();
    const result = await pool.query(
        `SELECT id, name, description, price, emoji FROM shop_items WHERE LOWER(name) = LOWER($1)`,
        [name]
    );
    return result.rows[0] || null;
}

/**
 * Create a new shop item.
 * @param {string} name
 * @param {string} description
 * @param {number} price
 * @param {string|null} emoji
 * @returns {Promise<Object>} The created item row
 */
export async function createShopItem(name, description, price, emoji = null) {
    const pool = getPool();
    const result = await pool.query(
        `INSERT INTO shop_items (name, description, price, emoji)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, description, price, emoji`,
        [name, description, price, emoji]
    );
    return result.rows[0];
}

// ─── user_inventory helpers ───────────────────────────────────────────────────

/**
 * Add an item to a user's inventory (or increment quantity if already owned).
 * @param {string} userId
 * @param {number} itemId
 * @param {number} quantity
 */
export async function addToInventory(userId, itemId, quantity = 1) {
    const pool = getPool();
    await pool.query(
        `INSERT INTO user_inventory (user_id, item_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_id) DO UPDATE
         SET quantity = user_inventory.quantity + $3`,
        [userId, itemId, quantity]
    );
}

/**
 * Get all inventory items for a user, joined with shop_items for display info.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
export async function getUserInventory(userId) {
    const pool = getPool();
    const result = await pool.query(
        `SELECT si.id, si.name, si.description, si.emoji, ui.quantity, ui.purchased_at
         FROM user_inventory ui
         JOIN shop_items si ON si.id = ui.item_id
         WHERE ui.user_id = $1
         ORDER BY ui.purchased_at DESC`,
        [userId]
    );
    return result.rows;
}
