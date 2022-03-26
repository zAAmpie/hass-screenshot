const config = require("./config");
const path = require("path");
const http = require("http");
const https = require("https");
const { promises: fs } = require("fs");
const fsExtra = require("fs-extra");
const puppeteer = require("puppeteer");
const { CronJob } = require("cron");
const gm = require("gm");

// Overwriting
console.logReal = console.log;
console.errorReal = console.error;
console.log = function () {
  var args = [].slice.call(arguments);
  console.logReal.apply(console.log,['[' + (new Date()).toLocaleString() + ']'].concat(args));
};
console.error = function () {
  var args = [].slice.call(arguments);
  console.errorReal.apply(console.error,['[' + (new Date()).toLocaleString() + ']'].concat(args));
};

// keep state of current battery level and whether the device is charging
//const batteryStore = {}; // TODO remove refrences to this
const stateStore = {};

(async () => {
  if (config.pages.length === 0) {
    return console.error("Please check your configuration");
  }
  for (const i in config.pages) {
    const pageConfig = config.pages[i];
    if (pageConfig.rotation % 90 > 0) {
      return console.error(
        `Invalid rotation value for entry ${i + 1}: ${pageConfig.rotation}`
      );
    }
  }

  console.log("Starting browser...");
  let browser = await puppeteer.launch({
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      `--lang=${config.language}`,
      config.ignoreCertificateErrors && "--ignore-certificate-errors"
    ].filter((x) => x),
    headless: config.debug !== true
  });

  console.log(`Visiting '${config.baseUrl}' to login...`);
  let page = await browser.newPage();
  await page.goto(config.baseUrl, {
    timeout: config.renderingTimeout
  });

  const hassTokens = {
    hassUrl: config.baseUrl,
    access_token: config.accessToken,
    token_type: "Bearer"
  };

  console.log("Adding authentication entry to browser's local storage...");
  await page.evaluate(
    (hassTokens, selectedLanguage) => {
      localStorage.setItem("hassTokens", hassTokens);
      localStorage.setItem("selectedLanguage", selectedLanguage);
    },
    JSON.stringify(hassTokens),
    JSON.stringify(config.language)
  );

  page.close();

  if (config.debug) {
    console.log(
      "Debug mode active, will only render once in non-headless model and keep page open"
    );
    renderAndConvertAsync(browser);
  } else {
    console.log("Starting first render...");
    renderAndConvertAsync(browser);
    console.log("Starting rendering cronjob...");
    new CronJob({
      cronTime: config.cronJob,
      onTick: () => renderAndConvertAsync(browser),
      start: true
    });
  }

  const httpServer = http.createServer(async (request, response) => {
    // Parse the request
    console.log(`recieved request from ${request.connection.remoteAddress} for ${request.url}`);
    const url = new URL(request.url, `http://${request.headers.host}`);
    // Check the page number
    const pageNumberStr = url.pathname;
    saveState(url.searchParams);
    const pageNumber =
      pageNumberStr === "/" ? 1 : parseInt(pageNumberStr.substr(1));
    if (
      isFinite(pageNumber) === false ||
      pageNumber > config.pages.length ||
      pageNumber < 1
    ) {
      console.log(`Invalid request: ${request.url} for page ${pageNumber}`);
      response.writeHead(404);
      response.end("Invalid request");
      return;
    }
    try {
      // Log when the page was accessed
      const n = new Date();
      console.log(`Image ${pageNumber} was accessed`);

      const pageIndex = pageNumber - 1;
      const configPage = config.pages[pageIndex];

      const data = await fs.readFile(configPage.outputPath);
      const stat = await fs.stat(configPage.outputPath);

      const lastModifiedTime = new Date(stat.mtime).toUTCString();

      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": Buffer.byteLength(data),
        "Last-Modified": lastModifiedTime
      });
      response.end(data);

    } catch (e) {
      console.error(e);
      response.writeHead(404);
      response.end("Image not found");
    }
  });

  const port = config.port || 5000;
  httpServer.listen(port, () => {
    console.log(`Server is running at ${port}`);
  });
})();

async function saveState(searchParams) {
  console.log(`testing params: ${searchParams}`);
  const deviceName = searchParams.get("name");
  if (!deviceName || deviceName == '') {
    return;
  }
  const batteryLevel = parseInt(searchParams.get("batteryLevel"));
  const isCharging = searchParams.get("isCharging");
  const refreshCount = parseInt(searchParams.get("c"));
  const ipAddress = searchParams.get("ip");
  const macAddress = searchParams.get("mac");
  const serialNumber = searchParams.get("sn");

  const state = {
    battery: batteryLevel,
    charging: (isCharging && isCharging.toLowerCase() == "yes"),
    name: deviceName,
    count: refreshCount,
    ipAddress: ipAddress,
    macAddress: macAddress,
    serialNumber: serialNumber
  };
  console.log(`DEBUG: new state for '${deviceName}': ${JSON.stringify(state)}`); // TODO comment out
  stateStore[deviceName] = state;
}

async function renderAndConvertAsync(browser) {
  for (let pageIndex = 0; pageIndex < config.pages.length; pageIndex++) {
    const pageConfig = config.pages[pageIndex];

    const url = `${config.baseUrl}${pageConfig.screenShotUrl}`;

    const outputPath = pageConfig.outputPath;
    await fsExtra.ensureDir(path.dirname(outputPath));

    const tempPath = outputPath + ".temp";

    console.log(`Rendering ${url} to image...`);

    try {
      await renderUrlToImageAsync(browser, pageConfig, url, tempPath);
    } catch (e) {
      console.error(`Failed to render ${url}`);
      console.error(`Error: ${e}`);
      return
    }

    console.log(`Converting rendered screenshot of ${url} to grayscale png...`);
    await convertImageToKindleCompatiblePngAsync(
      pageConfig,
      tempPath,
      outputPath
    );

    fs.unlink(tempPath);
    console.log(`Finished ${url}`);

    // TODO delete this?
    // if (
    //   pageBatteryStore &&
    //   pageBatteryStore.batteryLevel !== null &&
    //   pageConfig.batteryWebHook
    // ) {
    //   sendBatteryLevelToHomeAssistant(
    //     pageIndex,
    //     pageBatteryStore,
    //     pageConfig.batteryWebHook
    //   );
    // }
  }
}

// TODO delete this?
function sendBatteryLevelToHomeAssistant(
  pageIndex,
  batteryStore,
  batteryWebHook
) {
  const batteryStatus = JSON.stringify(batteryStore);
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(batteryStatus)
    }
  };
  const url = `${config.baseUrl}/api/webhook/${batteryWebHook}`;
  const httpLib = url.toLowerCase().startsWith("https") ? https : http;
  const req = httpLib.request(url, options, (res) => {
    if (res.statusCode !== 200) {
      console.error(
        `Update device ${pageIndex} at ${url} status ${res.statusCode}: ${res.statusMessage}`
      );
    }
  });
  req.on("error", (e) => {
    console.error(`Update ${pageIndex} at ${url} error: ${e.message}`);
  });
  req.write(batteryStatus);
  req.end();
}

async function renderUrlToImageAsync(browser, pageConfig, url, path) {
  let page;
  try {
    page = await browser.newPage();
    await page.emulateMediaFeatures([
      {
        name: "prefers-color-scheme",
        value: "light"
      }
    ]);

    let size = {
      width: Number(pageConfig.renderingScreenSize.width),
      height: Number(pageConfig.renderingScreenSize.height)
    };

    if (pageConfig.rotation % 180 > 0) {
      size = {
        width: size.height,
        height: size.width
      };
    }

    await page.setViewport(size);
    const startTime = new Date().valueOf();
    await page.goto(url, {
      waitUntil: ["domcontentloaded", "load", "networkidle0"],
      timeout: config.renderingTimeout
    });

    const navigateTimespan = new Date().valueOf() - startTime;
    await page.waitForSelector("home-assistant", {
      timeout: Math.max(config.renderingTimeout - navigateTimespan, 1000)
    });

    await page.addStyleTag({
      content: `
        body {
          width: calc(${size.width}px / ${pageConfig.scaling});
          height: calc(${size.height}px / ${pageConfig.scaling});
          transform-origin: 0 0;
          transform: scale(${pageConfig.scaling});
          overflow: hidden;
        }`
    });

    if (pageConfig.renderingDelay > 0) {
      await page.waitForTimeout(pageConfig.renderingDelay);
    }
    await page.screenshot({
      path,
      type: "png",
      clip: {
        x: 0,
        y: 0,
        ...size
      }
    });
  } finally {
    if (config.debug === false) {
      await page.close();
    }
  }
}

function convertImageToKindleCompatiblePngAsync(
  pageConfig,
  inputPath,
  outputPath
) {
  return new Promise((resolve, reject) => {
    gm(inputPath)
      .options({
        imageMagick: config.useImageMagick === true
      })
      .dither(pageConfig.dither)
      .rotate("white", pageConfig.rotation)
      //.map("/app/colortable8.png")
      .type(pageConfig.colorMode)
      .bitdepth(pageConfig.grayscaleDepth)
      .quality(100)
      .write(outputPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
  });
}
