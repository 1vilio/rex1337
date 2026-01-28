import logger from "./logger.js";

export function validateAccounts(accounts) {
  if (!Array.isArray(accounts)) {
    throw new Error("accounts.json must be an array");
  }

  if (accounts.length === 0) {
    logger.warn("No accounts found in accounts.json");
    return false;
  }

  for (const acc of accounts) {
    if (!acc.username || !acc.password) {
      throw new Error(
        `Account missing required fields (username or password): ${JSON.stringify(
          acc
        )}`
      );
    }
  }

  return true;
}
