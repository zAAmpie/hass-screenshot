function getEnvironmentVariable(key, suffix, fallbackValue) {
  const value = process.env[key + suffix];
  if (value !== undefined) return value;
  return fallbackValue || process.env[key];
}

function getPagesConfig() {
  const pages = [];
  let i = 0;
  while (++i) {
    const suffix = i === 1 ? "" : `_${i}`;
    const screenShotUrl = process.env[`HA_SCREENSHOT_URL${suffix}`];
    if (!screenShotUrl) return pages;
    pages.push({
      screenShotUrl,
      outputPath: getEnvironmentVariable(
        "OUTPUT_PATH",
        suffix,
        `output/cover${suffix}.png`
      ),
      renderingDelay: getEnvironmentVariable("RENDERING_DELAY", suffix) || 0,
      renderingScreenSize: {
        height:
          getEnvironmentVariable("RENDERING_SCREEN_HEIGHT", suffix) || 800,
        width: getEnvironmentVariable("RENDERING_SCREEN_WIDTH", suffix) || 600,
      },
      grayscaleDepth: getEnvironmentVariable("GRAYSCALE_DEPTH", suffix) || 8,
      removeGamma: getEnvironmentVariable("REMOVE_GAMMA", suffix) || false,
      dither: getEnvironmentVariable("DITHER", suffix) || false,
      colorMode: getEnvironmentVariable("COLOR_MODE", suffix) || "GrayScale",
      refersColorScheme: getEnvironmentVariable("PREFERS_COLOR_SCHEME", suffix) || "light",
      rotation: getEnvironmentVariable("ROTATION", suffix) || 0,
      scaling: getEnvironmentVariable("SCALING", suffix) || 1,
      batteryWebHook: getEnvironmentVariable("HA_BATTERY_WEBHOOK", suffix) || null,
      realTimeCacheSec: getEnvironmentVariable("REAL_TIME_CACHE_SEC", suffix) || 60,
    });
  }
  return pages;
}

module.exports = {
  baseUrl: process.env.HA_BASE_URL,
  accessToken: process.env.HA_ACCESS_TOKEN,
  cronJob: process.env.CRON_JOB || "* * * * *",
  useImageMagick: process.env.USE_IMAGE_MAGICK === "true",
  pages: getPagesConfig(),
  port: process.env.PORT || 5000,
  renderingTimeout: process.env.RENDERING_TIMEOUT || 10000,
  language: process.env.LANGUAGE || "en",
  debug: process.env.DEBUG === "true",
  realTime: process.env.REAL_TIME === "true",
  ignoreCertificateErrors:
    process.env.UNSAFE_IGNORE_CERTIFICATE_ERRORS === "true",
  mqttServer: process.env.MQTT_SERVER || null,
  mqttUser: process.env.MQTT_USERNAME || null,
  mqttPassword: process.env.MQTT_PASSWORD || null,
};
