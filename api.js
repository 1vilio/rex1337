import { config } from "./config.js";

class apiWrapper {
  url;

  constructor() {
    this.url = "https://rep4rep.com/pub-api";
  }

  async request(path, params = {}, method = "GET") {
    const searchParams = new URLSearchParams({
      apiToken: config.apiKey,
      ...params,
    });
    const options = { method };

    let url = `${this.url}${path}`;
    if (method === "GET") {
      url += `?${searchParams.toString()}`;
    } else {
      options.body = searchParams;
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (e) {
      throw new Error(`API Error (${path}): ${e.message}`);
    }
  }

  async addSteamProfile(steamId) {
    return this.request(
      "/user/steamprofiles/add",
      { steamProfile: steamId },
      "POST"
    );
  }

  async getSteamProfiles() {
    return this.request("/user/steamprofiles");
  }

  async getTasks(r4rSteamId) {
    const data = await this.request("/tasks", { steamProfile: r4rSteamId });
    return Array.isArray(data) ? data : [];
  }

  async completeTask(taskId, commentId, authorSteamProfileId) {
    return this.request(
      "/tasks/complete",
      {
        taskId,
        commentId,
        authorSteamProfileId,
      },
      "POST"
    );
  }
}

const instance = new apiWrapper();
export { instance as default };
