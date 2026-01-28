import SteamUser from "steam-user";
import SteamCommunity from "steamcommunity";
import SteamTotp from "steam-totp";
import { readFileSync, writeFileSync, existsSync } from "fs";
import api from "./api.js";
import { config } from "./config.js";
import logger from "./logger.js";
import { startServer, updateAppState, appState } from "./server.js";

const STATE_FILE = "./data/state.json";
let isRunning = true;
let taskHistory = []; // Тркеаем последние успешные задания за 24 часа

// --- Graceful Shutdown ---
const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  isRunning = false;
  updateAppState({ status: "shutting_down" });
  setTimeout(() => {
    logger.info("Cleanup complete. Goodbye!");
    process.exit(0);
  }, 2000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);


startServer();

// Стейт менеджмент
function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf8"));
    } catch (e) {
      logger.error("Error reading state.json: %s", e.message);
    }
  }
  return {
    lastResetDate: new Date().toDateString(),
    lastWeeklyReset: getWeekNumber(new Date()),
  };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getWeekNumber(d) {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function checkDateResets() {
  const state = loadState();
  const today = new Date().toDateString();
  const currentWeek = getWeekNumber(new Date());
  let changed = false;

  if (state.lastResetDate !== today) {
    logger.info("New day detected. Resetting daily counters.");
    for (let user in state) {
      if (typeof state[user] === "object") state[user].completedToday = 0;
    }
    state.lastResetDate = today;
    changed = true;
  }

  if (state.lastWeeklyReset !== currentWeek) {
    logger.info("New week detected. Resetting weekly counters.");
    for (let user in state) {
      if (typeof state[user] === "object") state[user].completedThisWeek = 0;
    }
    state.lastWeeklyReset = currentWeek;
    changed = true;
  }

  if (changed) saveState(state);
}

function syncDashboardAccounts() {
  checkDateResets();
  const state = loadState();
  let totalWeekly = 0;

  const accounts = config.accounts.map((acc) => {
    const accState = state[acc.username] || {};
    const isCooldown = accState.cooldownUntil > Date.now();
    let status = "farm";

    totalWeekly += accState.completedThisWeek || 0;

    if (isCooldown) {
      status = "idle";
    } else if (accState.lastError) {
      status = "error";
    }

    return {
      username: acc.username,
      nickname: acc.nickname || null,
      avatarUrl: accState.avatarUrl || null,
      status: status,
      steamID: accState.steamID || null,
      cooldownUntil: accState.cooldownUntil || null,
      progress: accState.completedToday || 0,
      totalCompleted: accState.totalCompleted || 0,
      cooldown: isCooldown
        ? `Until ${new Date(accState.cooldownUntil).toLocaleTimeString(
          "en-GB",
        )}`
        : accState.lastError
          ? "FAILED"
          : "Available",
    };
  });

  updateAppState({
    accounts,
    stats: { ...appState.stats, totalWeekly },
    system: { ...appState.system, totalAccounts: accounts.length },
  });
}

function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Кор логика скрипта
async function loginAccount(account) {
  return new Promise((resolve, reject) => {
    const user = new SteamUser({ renewRefreshTokens: true });
    const community = new SteamCommunity();
    let logOnOptions = {};

    const tokenFile = `./data/refresh_token_${account.username}.txt`;
    if (existsSync(tokenFile)) {
      const refreshToken = readFileSync(tokenFile, "utf8").trim();
      logOnOptions = { refreshToken };
    } else {
      logOnOptions = {
        accountName: account.username,
        password: account.password,
      };

      if (account.sharedSecret) {
        logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(
          account.sharedSecret,
        );
        logger.info("[LOGIN] Generating 2FA code...", {
          account: account.username,
        });
      }
    }

    user.logOn(logOnOptions);

    user.on("loggedOn", function () {
      logger.info(`[LOGIN] Logged on as ${this.steamID}`, {
        account: account.username,
      });
      user.setPersona(SteamUser.EPersonaState.Online);
    });

    user.on("webSession", (sessionID, cookies) => {
      community.setCookies(cookies);
      logger.info("[LOGIN] Steam Session Ready & Cookies Set", {
        account: account.username,
      });

      user.getPersonas([user.steamID], (err, personas) => {
        let avatarUrl = null;
        let steamNickname = null;
        if (!err && personas[user.steamID.getSteamID64()]) {
          const p = personas[user.steamID.getSteamID64()];
          avatarUrl = `https://avatars.akamai.steamstatic.com/${p.avatar_hash}_full.jpg`;
          steamNickname = p.player_name;
        }
        resolve({
          steamID: user.steamID.getSteamID64(),
          user,
          community,
          username: account.username,
          avatarUrl,
          steamNickname,
        });
      });
    });

    user.on("refreshToken", (token) => writeFileSync(tokenFile, token));
    user.on("error", (err) => {
      logger.error("[LOGIN] Error: %s", err.message, {
        account: account.username,
      });
      reject(err);
    });
  });
}

async function processAccount(session) {
  const { steamID, community, username, avatarUrl, steamNickname } = session;
  let sessionFailures = 0;

  const s = loadState();
  if (!s[username]) s[username] = {};
  s[username].avatarUrl = avatarUrl;
  s[username].steamNickname = steamNickname;
  s[username].steamID = steamID;
  saveState(s);
  syncDashboardAccounts();

  try {
    logger.info("[TASKS] Checking tasks...", { account: username });
    updateAppState({
      logEntry: { text: `${username}: Checking tasks...`, type: "info" },
    });

    const steamProfiles = await api.getSteamProfiles();
    let r4rProfile = steamProfiles.find((p) => p.steamId === steamID);

    if (!r4rProfile) {
      logger.info("[API] Registering profile on Rep4Rep...", {
        account: username,
      });
      await api.addSteamProfile(steamID);
      const updated = await api.getSteamProfiles();
      r4rProfile = updated.find((p) => p.steamId === steamID);
    }

    if (!r4rProfile) throw new Error("Rep4Rep profile init failed");

    const tasks = await api.getTasks(r4rProfile.id);
    logger.info(`[TASKS] Found ${tasks.length} tasks for this account.`, {
      account: username,
    });

    if (tasks.length === 0) {
      logger.info("[TASKS] No work available. Skipping.", {
        account: username,
      });
      updateAppState({
        logEntry: { text: `${username}: No tasks available`, type: "info" },
      });
      return;
    }

    for (const task of tasks) {
      if (!isRunning) break;

      const state = loadState();
      const completedToday = state[username]?.completedToday || 0;

      if (completedToday >= config.system.dailyLimit) {
        logger.info("[LIMIT] Daily limit reached.", { account: username });
        state[username].cooldownUntil =
          Date.now() + config.system.cooldownHours * 60 * 60 * 1000;
        state[username].lastError = null;
        saveState(state);
        syncDashboardAccounts();
        break;
      }

      logger.info(`[WORK] Target: ${task.targetSteamProfileId}`, {
        account: username,
      });

      const taskStart = Date.now();
      const result = await new Promise((resolve) => {
        community.postUserComment(
          task.targetSteamProfileId,
          task.requiredCommentText,
          (err) => {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true });
          },
        );
      });

      if (result.success) {
        const taskDuration = Date.now() - taskStart;
        const currentAvg = appState.stats.avgTaskTime || 0;
        const newAvg =
          currentAvg === 0
            ? taskDuration
            : currentAvg * 0.9 + taskDuration * 0.1;

        updateAppState({
          stats: { ...appState.stats, avgTaskTime: Math.round(newAvg) },
        });

        logger.info(
          `[SUCCESS] Posted comment to ${task.targetSteamProfileId
          } (${Math.round(taskDuration / 1000)}s)`,
          { account: username },
        );
        await api.completeTask(
          task.taskId,
          task.requiredCommentId,
          r4rProfile.id,
        );
        sessionFailures = 0;

        const newState = loadState();
        newState[username] = {
          ...(newState[username] || {}),
          completedToday: (newState[username]?.completedToday || 0) + 1,
          completedThisWeek: (newState[username]?.completedThisWeek || 0) + 1,
          totalCompleted: (newState[username]?.totalCompleted || 0) + 1,
          lastSuccess: Date.now(),
          lastError: null,
          lastErrorType: null,
        };
        saveState(newState);

        const elapsedHours = (Date.now() - appState.startTime) / 3600000;
        const totalEarned = (appState.stats.todayEarned || 0) + 1;
        const cph =
          elapsedHours > 0.01 ? (totalEarned / elapsedHours).toFixed(1) : 0;

        taskHistory.push(Date.now());
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        taskHistory = taskHistory.filter((t) => t > oneDayAgo);

        updateAppState({
          logEntry: {
            text: `${username}: Success on ${task.targetSteamProfileId}`,
            type: "success",
          },
          stats: {
            ...appState.stats,
            todayEarned: totalEarned,
            commentsPerHour: parseFloat(cph),
            taskHistory,
          },
        });
        syncDashboardAccounts();

        const delay = getRandomDelay(config.delay.min, config.delay.max);
        logger.info(`[SLEEP] Waiting ${Math.round(delay / 1000)}s...`, {
          account: username,
        });
        await sleep(delay);
      } else {
        const isRateLimit =
          result.error.includes("frequently") || result.error.includes("429");
        const isSettingsError = result.error.includes(
          "allow you to add comments",
        );

        if (isSettingsError) {
          sessionFailures++;
          logger.warn(
            `[SKIP] Target restricted (${sessionFailures}/${config.system.consecutiveFailuresLimit})`,
            { account: username },
          );
          updateAppState({
            logEntry: { text: `${username}: Target restricted`, type: "warn" },
          });

          if (sessionFailures >= config.system.consecutiveFailuresLimit) {
            logger.warn("[COOLDOWN] Too many restricted profiles. 2h sleep.", {
              account: username,
            });
            const s = loadState();
            s[username].cooldownUntil = Date.now() + 2 * 60 * 60 * 1000;
            s[username].lastError = "Consecutive failures";
            saveState(s);
            syncDashboardAccounts();
            break;
          }
          continue;
        }

        if (isRateLimit) {
          const s = loadState();
          const isTiered = s[username]?.lastErrorType === "429";
          const waitMs = isTiered ? 20 * 60 * 1000 : 12 * 60 * 60 * 1000;
          logger.warn(
            `[RATE] Limit hit. Sleeping ${isTiered ? "20m" : "12h"}.`,
            { account: username },
          );
          s[username].cooldownUntil = Date.now() + waitMs;
          s[username].lastError = result.error;
          s[username].lastErrorType = "429";
          saveState(s);
          syncDashboardAccounts();
          break;
        }
        logger.error(`[ERROR] Comment failed: ${result.error}`, {
          account: username,
        });
        await sleep(5000);
      }
    }
  } catch (e) {
    const isNetworkError =
      e.message.includes("EAI_AGAIN") ||
      e.message.includes("ECONNRESET") ||
      e.message.includes("timeout");
    if (isNetworkError) {
      logger.warn(`[NETWORK] Lost connection during processing: ${e.message}`, {
        account: username,
      });
    } else {
      logger.error(`[ERROR] Processing Failure: ${e.message}`, {
        account: username,
      });
    }
  } finally {
    logger.info("[LOGOFF] Session wrapped up.", { account: username });
    session.user.logOff();
  }
}

async function main() {
  logger.info("--- REP4REP BOT STARTED (V1.4.0) ---");
  updateAppState({
    logEntry: {
      text: "System initialized. Waiting for accounts...",
      type: "info",
    },
    status: "idle",
  });
  syncDashboardAccounts();

  while (isRunning) {
    try {
      const memoryUsage =
        (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + " MB";

      // Индикаторы здоровья апишек
      const apiStatus = {
        rep4rep: "online",
        steam: "online",
        db: "online",
      };

      updateAppState({
        logEntry: "Cycle started: Syncing health indicators...",
        system: { ...appState.system, memoryUsage, apiStatus },
      });

      const state = loadState();
      let nextAvailableTime = Infinity;
      let accountsAttempted = 0;

      const accounts = config.accounts;
      for (const account of accounts) {
        if (!isRunning) break;
        const cooldownUntil = state[account.username]?.cooldownUntil || 0;
        if (cooldownUntil > Date.now()) {
          nextAvailableTime = Math.min(nextAvailableTime, cooldownUntil);
          continue;
        }

        try {
          accountsAttempted++;
          updateAppState({
            status: "processing",
            currentAccount: account.username,
          });
          const session = await loginAccount(account);
          await processAccount(session);
          syncDashboardAccounts();
          await sleep(config.delay.accountSwitch);
        } catch (e) {
          logger.error(
            `[FATAL] Account ${account.username} Failed: ${e.message}`,
          );
          syncDashboardAccounts();
        }
      }

      if (!isRunning) break;

      if (accountsAttempted === 0) {
        const waitMs =
          nextAvailableTime !== Infinity
            ? Math.max(0, nextAvailableTime - Date.now())
            : 600000;
        const nextWake = new Date(Date.now() + waitMs).toLocaleTimeString(
          "en-GB",
        );
        logger.info(`[CYCLE] No accounts ready. Sleeping until ${nextWake}...`);
        updateAppState({
          status: "idle",
          system: { ...appState.system, nextCycle: nextWake },
        });

        const chunk = 5000;
        let waited = 0;
        let lastCount = config.accounts.length;
        while (waited < waitMs && isRunning) {
          if (config.accounts.length !== lastCount) {
            logger.info(
              "[DYNAMIC] Accounts list changed! Re-scanning immediately.",
            );
            break;
          }
          await sleep(Math.min(chunk, waitMs - waited));
          waited += chunk;
        }
      } else {
        logger.info("[CYCLE] Loop finished. Short 60s rest.");
        updateAppState({
          status: "idle",
          system: { ...appState.system, nextCycle: "60s" },
        });
        await sleep(60000);
      }
    } catch (e) {
      logger.error(
        `[CRITICAL] Main Loop Panic: ${e.message}. Retrying in 30s...`,
      );
      await sleep(30000);
    }
  }
}

main();
