import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

const DATA_DIR = "./data";
const ACCOUNTS_FILE = `${DATA_DIR}/accounts.json`;
const SETTINGS_FILE = `${DATA_DIR}/settings.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadJson(file, defaultVal = []) {
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`Error parsing ${file}:`, e.message);
    }
  }
  return defaultVal;
}

const defaultSettings = {
  system: {
    dailyLimit: 10,
    cooldownHours: 24,
    consecutiveFailuresLimit: 7,
    logLevel: process.env.LOG_LEVEL || "info",
  },
  delay: {
    min: parseInt(process.env.MIN_COMMENT_DELAY || "60") * 1000,
    max: parseInt(process.env.MAX_COMMENT_DELAY || "300") * 1000,
    accountSwitch: parseInt(process.env.ACCOUNT_SWITCH_DELAY || "30") * 1000,
  },
};

if (!existsSync(SETTINGS_FILE)) {
  writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
}

const settings = loadJson(SETTINGS_FILE, defaultSettings);

const config = {
  get accounts() {
    return loadJson(ACCOUNTS_FILE);
  },
  apiKey: process.env.REP4REP_KEY || "",
  ...settings,
};

export { config };
