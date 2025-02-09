import puppeteer, { ElementHandle, Page } from 'puppeteer';
import fs from 'fs';

type Wisata_Data = {
  title: string;
  about: string;
  address: string;
  rating: number;
  reviewers: number;
  link: string;
  province: string;
  images: {
    url: string;
  }[];
};

// Main function
const main = async () => {
  // File path
  const FILE_PATH = `data/wisata.json`;

  // Fetch kabupaten kota data
  const kabupatenKotaData = await fetchDataKabupatenKota();

  for (const kabupatenKota of kabupatenKotaData) {
    // Data to be populated
    const WISATA_DATA: Wisata_Data[] = [];

    console.log(
      `[${new Date().toLocaleTimeString()}] Scraping data for: `,
      kabupatenKota
    );

    // Search key
    const SEARCH_KEY = `Wisata ${kabupatenKota}`;

    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: true,
    });
    const page = await browser.newPage();

    // Navigate the page to a URL
    await page.goto('https://www.google.com/maps');

    // Set screen size
    await page.setViewport({ width: 1080, height: 1024 });

    // Type in the search bar
    await page.type('#searchboxinput', SEARCH_KEY);
    // Press Enter
    await page.keyboard.press('Enter');

    // Search results box
    const searchResultBox = await page.waitForSelector(
      `div[aria-label="Hasil untuk ${SEARCH_KEY}"]`
    );

    if (searchResultBox) {
      // Scroll down the search results box to load more results until the end
      await scrollToEnd(page, searchResultBox);

      // Get all the search results
      const allResults = await searchResultBox.$$(`div:has(div>a)`);

      let index = 0;
      while (true) {
        // Progress bar for terminal
        const progressPercentage = Math.floor(
          (index / allResults.length) * 100
        );
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
          `Progress: ${drawProgressBar(progressPercentage)} [${index}/${
            allResults.length
          }]`
        );

        const item = allResults[index];

        if (!item) {
          break;
        }

        // Get the anchor element
        const anchorElem = await item.$('div>a');

        // Get the rating
        const ratingElem = await item.$(
          'span.fontBodyMedium span[role="img"] span:first-child'
        );
        const reviewersElem = await item.$(
          'span.fontBodyMedium span[role="img"] span:last-child'
        );

        // Check if has image
        const isNoImage = await item.$(
          'img[src="//maps.gstatic.com/tactile/pane/result-no-thumbnail-1x.png"]'
        );

        if (!anchorElem || !ratingElem || !reviewersElem || isNoImage) {
          index++;
          continue;
        }

        // DATA: link
        const link = (
          await anchorElem
            .getProperty('href')
            .then((prop) => prop.jsonValue())
            .then((val) => val ?? '')
        ).replace('JSHandle:', '');

        // DATA: rating
        const rating = parseFloat(
          (
            await ratingElem
              .getProperty('innerText')
              .then((prop) => prop.jsonValue())
              .then((val) => val ?? '0')
          ).replace(',', '.')
        );

        // DATA: reviewers
        const reviewers = parseFloat(
          (
            await reviewersElem
              .getProperty('innerText')
              .then((prop) => prop.jsonValue())
              .then((val) => val ?? '0')
          )
            .replace('(', '')
            .replace(')', '')
            .replace('.', '')
        );

        // Skip if reviewers less than 10
        if (reviewers < 10) {
          index++;
          continue;
        }

        // DATA: title
        const title = (
          await anchorElem
            .getProperty('ariaLabel')
            .then((prop) => prop.jsonValue())
            .then((val) => val ?? '')
        ).replace('JSHandle:', '');

        // Click the anchor element
        await anchorElem.click();
        await customDelay(200);
        await anchorElem.click();

        // Wait for the details to load
        const panel = await page
          .waitForSelector(`div[role="main"][aria-label="${title}"]`, {
            visible: true,
            timeout: 10000,
          })
          .catch(() => {
            return null;
          });

        if (!panel) {
          index++;
          continue;
        }

        // DATA: about
        const about = await page
          .waitForSelector(
            `div[role="region"][aria-label="Tentang ${title}"] div.fontBodyMedium div>div:first-child`,
            { visible: true, timeout: 2000 }
          )
          .then(async (elem) => {
            return elem ? await elem.getProperty('innerText') : null;
          })
          .then((prop) => (prop ? prop.jsonValue() : ''))
          .catch(() => '');

        // DATA: address
        const address = await page
          .waitForSelector(
            `div[role="region"] button[data-tooltip="Salin alamat"] div.fontBodyMedium`,
            { visible: true, timeout: 2000 }
          )
          .then(async (elem) => {
            return elem ? await elem.getProperty('innerText') : null;
          })
          .then((prop) => (prop ? prop.jsonValue() : ''))
          .catch(() => '');

        // DATA: images
        const images = [];
        const previewImage = await item.$('img');
        if (previewImage) {
          const previewImageUrl = await previewImage
            .getProperty('src')
            .then((prop) => prop.jsonValue())
            .then((val) => val ?? null);

          if (previewImageUrl.includes('streetview')) {
            index++;
            continue;
          }

          const imageCarousel = await page
            .waitForSelector(
              `div[aria-roledescription="carousel"][aria-label="Foto ${title}"]`,
              { visible: true, timeout: 2000 }
            )
            .then(async (elem) => {
              return elem ? await elem.$$(`button>img`) : [];
            })
            .catch(() => []);

          for (const image of imageCarousel) {
            const imageUrl = await image
              .getProperty('src')
              .then((prop) => prop.jsonValue())
              .then((val) => val ?? null);

            // Check if the 4 last characters are k-no
            if (imageUrl.split('').slice(-4).join('') === 'k-no') {
              const formattedImageUrl = imageUrl
                .split('=')
                .map((val, i) => {
                  if (i === 1) {
                    return 's1920-k-no';
                  }

                  return val;
                })
                .join('=');

              if (imageUrl) {
                images.push({
                  url: formattedImageUrl,
                });
              }
            }
          }
        }

        WISATA_DATA.push({
          title,
          about,
          address,
          rating,
          reviewers,
          images,
          link,
          province: kabupatenKota,
        });

        await customDelay(1000);
        index++;
      }
    }

    setTimeout(async () => {
      // Close the browser
      await browser.close();
    }, 3000);

    // Save the data in json file
    let existingData: Wisata_Data[] = [];

    if (fs.existsSync(FILE_PATH)) {
      const rawData = fs.readFileSync(FILE_PATH, 'utf-8');
      existingData = JSON.parse(rawData);
    }

    // Make sure there's no duplicate date by comparing title and address
    const updatedData = [
      ...new Map(
        [...existingData, ...WISATA_DATA].map((item) => [item.link, item])
      ).values(),
    ];

    fs.writeFileSync(FILE_PATH, JSON.stringify(updatedData));

    console.log('\n');
  }
};

/**
 * Draw progress bar
 * @param progress
 * @returns
 */
const drawProgressBar = (progress: number) => {
  const barWidth = 30;
  const filledWidth = Math.floor((progress / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;
  const progressBar = '█'.repeat(filledWidth) + '▒'.repeat(emptyWidth);
  return `[${progressBar}] ${progress}%`;
};

/**
 * Fetch data kabupaten kota
 * @returns
 */
const fetchDataKabupatenKota = async () => {
  const csv = await fetch(
    'https://raw.githubusercontent.com/kodewilayah/permendagri-72-2019/main/dist/base.csv',
    {
      method: 'GET',
    }
  ).then((res) => res.text());

  const splitted = csv.split('\n');
  const formattedFullData = splitted
    .filter((val) => val.split(',')[0].split('.').length <= 2)
    .map((val) => {
      return {
        code: val.split(',')[0],
        name: val.split(',')[1]
          ? val.split(',')[1].replace('KAB.', 'KABUPATEN')
          : '',
      };
    });

  const formattedData = formattedFullData
    .filter((val) => val.name !== '')
    .filter((val) => val.code.split('.').length === 2)
    .map((val) => {
      const provinceName = formattedFullData.find(
        (v) => v.code === val.code.split('.')[0]
      )?.name;
      return `${val.name}, PROVINSI ${provinceName}`;
    });

  // Shuffle the data
  for (let i = formattedData.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [formattedData[i], formattedData[j]] = [formattedData[j], formattedData[i]];
  }

  return formattedData;
};

/**
 * Custom delay function
 * @param ms
 * @returns
 */
const customDelay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scroll to the end of the page
 * @param {Page} page
 * @param {ElementHandle<HTMLDivElement>} box
 */
const scrollToEnd = async (page: Page, box: ElementHandle<HTMLDivElement>) => {
  let previousHeight = 0;

  while (true) {
    const currentHeight = await page.evaluate((box) => {
      if (box) {
        box.scrollBy(0, box.scrollHeight);
        return box.scrollHeight;
      }
    }, box);

    await customDelay(1000);

    if (currentHeight === previousHeight) {
      break;
    }

    previousHeight = currentHeight ?? 0;
  }
};

/**
 * Main function
 */
main();
