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
    author: {
      name: string;
      link: string;
      photoUrl: string;
    };
  }[];
};

// Main function
const main = async () => {
  // File path
  const FILE_PATH = `data/wisata-v2.json`;
  const LOG_PATH = `data/daerah-log.json`;

  // Fetch kabupaten kota data
  const kabupatenKotaData = await fetchDataKabupatenKota();
  console.log('Fetching data for', kabupatenKotaData.length, 'daerah...');

  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({
    headless: false,
  });
  const page = await browser.newPage();

  for (const kabupatenKota of kabupatenKotaData) {
    // Data to be populated
    const WISATA_DATA: Wisata_Data[] = [];

    console.log(
      `[${new Date().toLocaleTimeString()}] Scraping data for:`,
      kabupatenKota
    );

    // Search key
    const SEARCH_KEY = `Wisata ${kabupatenKota}`;

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

        WISATA_DATA.push({
          title,
          about: '',
          address: '',
          rating,
          reviewers,
          images: [],
          link,
          province: kabupatenKota,
        });

        index++;
      }
    }

    console.log(`Populating images for ${WISATA_DATA.length} data...`);

    // DATA: Images, About, Address
    const WISATA_DATA_WITH_IMAGES: Wisata_Data[] = [];
    let wisataIndex = 0;
    while (wisataIndex < WISATA_DATA.length) {
      const wisataTarget = WISATA_DATA[wisataIndex];

      // Progress bar
      const progressPercentage = Math.floor(
        ((wisataIndex + 1) / WISATA_DATA.length) * 100
      );
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`Progress: ${drawProgressBar(progressPercentage)}`);

      // Navigate to the link
      const pageStatus = await page
        .goto(wisataTarget.link, { timeout: 15000 })
        .catch(() => null);
      if (!pageStatus) {
        wisataIndex++;
        continue;
      }

      // Waiting for Gallery element
      const galleryElem = await page
        .waitForSelector(
          `div[aria-label="${wisataTarget.title}"][role="main"] button[aria-label="Foto ${wisataTarget.title}"]`,
          { timeout: 10000 }
        )
        .catch(() => null);

      // DATA: about
      const about = await page
        .waitForSelector(
          `div[role="region"][aria-label="Tentang ${wisataTarget.title}"] div.fontBodyMedium div>div:first-child`,
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

      if (!galleryElem) {
        wisataIndex++;
        continue;
      }

      await page.evaluate((galleryElem) => galleryElem.click(), galleryElem);

      // Waiting for Gallery panel
      const galleryPanelElem = await page
        .waitForSelector(
          `div[aria-label="Foto ${wisataTarget.title}"][role="main"]`,
          { timeout: 10000 }
        )
        .catch(() => null);
      // Waiting for the first gallery item
      const firstGalleryItem = await page
        .waitForSelector(
          `div[aria-label="Foto ${wisataTarget.title}"][role="main"] div:last-child>div:first-child div>div>a[href="#"]`,
          { timeout: 10000 }
        )
        .catch(() => null);

      if (!galleryPanelElem || !firstGalleryItem) {
        wisataIndex++;
        continue;
      }

      // Get all gallery items
      const galleryItems = await galleryPanelElem.$$(
        'div:last-child>div:first-child div>div>a[href="#"]'
      );

      const filteredGalleryItems = await Promise.all(
        galleryItems.filter(async (item) => {
          const isVideo = await item.$(`div[role="img"]>div.fontLabelMedium`);

          if (isVideo) {
            return false;
          }

          return true;
        })
      );

      try {
        // Iterate through all 5 gallery items
        const galleryResults: Wisata_Data['images'][0][] = [];
        let galleryItemIndex = 0;
        while (
          galleryResults.length < 5 &&
          galleryItemIndex < filteredGalleryItems.length
        ) {
          let resultItem: Wisata_Data['images'][0] = {
            url: '',
            author: {
              name: '',
              link: '',
              photoUrl: '',
            },
          };

          const galleryItem = filteredGalleryItems[galleryItemIndex];
          await page.evaluate(
            (galleryItem) => galleryItem.click(),
            galleryItem
          );
          await galleryItem.click();

          await customDelay(1000);

          const imageBox = await galleryItem
            .waitForSelector(`div[role="img"]>div.loaded`, { timeout: 1000 })
            .catch(() => {
              return null;
            });

          if (!imageBox) {
            galleryItemIndex++;
            continue;
          }

          const imageUrl = await imageBox
            .evaluate((el) => {
              return window.getComputedStyle(el).backgroundImage;
            })
            .then((res) => cleanBackgroundImageUrl(res));

          if (imageUrl.split('').slice(-4).join('') !== 'k-no') {
            galleryItemIndex++;
            continue;
          }

          // Log image URL
          resultItem.url = imageUrl
            .split('=')
            .map((val, i) => {
              if (i === 1) {
                return 's1080-k-no';
              }

              return val;
            })
            .join('=');

          // Waiting for image owner element
          const imageOwnerElem = await page
            .waitForSelector(`div[role="navigation"] h2.fontBodySmall>span`, {
              timeout: 3000,
            })
            .catch(() => null);

          if (!imageOwnerElem) {
            galleryItemIndex++;
            continue;
          }

          // Determine uploader type
          const isPlaceOwnerOrJustUser = await Promise.race([
            page
              .waitForSelector(
                `div#titlecard div[role="navigation"] h1>span:last-child:has(a)`,
                { timeout: 3000 }
              )
              .catch(() => null),
            page
              .waitForSelector(
                `div[role="navigation"] h2.fontBodySmall>span:has(a)`,
                { timeout: 3000 }
              )
              .catch(() => null),
          ]);

          if (isPlaceOwnerOrJustUser) {
            const imageOwnerPhoto = await isPlaceOwnerOrJustUser
              .waitForSelector('a:first-child>div', { timeout: 3000 })
              .then((el) => {
                return el
                  ?.evaluate((el) => {
                    return window.getComputedStyle(el).backgroundImage;
                  })
                  .then((res) => cleanBackgroundImageUrl(res));
              })
              .catch(() => null);

            const imageOwnerProfileLink = await isPlaceOwnerOrJustUser
              .waitForSelector('a:first-child', { timeout: 3000 })
              .then((el) => {
                return el?.evaluate((el) => {
                  return el.getAttribute('href');
                });
              })
              .catch(() => null);

            const imageOwnerName = await isPlaceOwnerOrJustUser
              .waitForSelector('a:last-child>span', { timeout: 3000 })
              .then((el) => {
                return el?.evaluate((el) => el.textContent);
              })
              .catch(() => null);

            resultItem.author = {
              photoUrl: imageOwnerPhoto ?? '',
              link: imageOwnerProfileLink ?? '',
              name: imageOwnerName ?? '',
            };
          }

          if (resultItem.url !== '' && resultItem.author.name !== '') {
            galleryResults.push(resultItem);
          }

          galleryItemIndex++;
        }

        WISATA_DATA_WITH_IMAGES.push({
          ...wisataTarget,
          about,
          address,
          images: galleryResults,
        });

        wisataIndex++;
      } catch (error) {
        wisataIndex++;
      }
    }

    // Save the data in json file
    let existingData: Wisata_Data[] = [];
    if (fs.existsSync(FILE_PATH)) {
      const rawData = fs.readFileSync(FILE_PATH, 'utf-8');
      existingData = JSON.parse(rawData);
    }

    // Make sure there's no duplicate date by comparing title and address
    const updatedData = [
      ...new Map(
        [...existingData, ...WISATA_DATA_WITH_IMAGES].map((item) => [
          item.link,
          item,
        ])
      ).values(),
    ];

    fs.writeFileSync(FILE_PATH, JSON.stringify(updatedData));

    // Log the daerah
    const rawLogData = fs.readFileSync(LOG_PATH, 'utf-8');
    const rawParsedLogData = JSON.parse(rawLogData);

    fs.writeFileSync(
      LOG_PATH,
      JSON.stringify([kabupatenKota, ...rawParsedLogData], null, 2)
    );

    console.log('\n');
  }

  // Close the browser
  await browser.close();
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
  const LOG_PATH = `data/daerah-log.json`;

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

  const rawData = fs.readFileSync(LOG_PATH, 'utf-8');
  const rawParsedData = JSON.parse(rawData);

  const filteredData = formattedData.filter(
    (val) => !rawParsedData.includes(val)
  );
  // .filter((val) => val.toLowerCase().includes('jawa barat'));

  return shuffleArray(filteredData);
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

    await customDelay(2000);

    if (currentHeight === previousHeight) {
      break;
    }

    previousHeight = currentHeight ?? 0;
  }
};

/**
 * Clean background image url
 * @param url
 * @returns
 */
const cleanBackgroundImageUrl = (url: string) =>
  url.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');

/**
 * Shuffle array
 * @param array
 * @returns
 */
const shuffleArray = <T>(array: T[]) => {
  let currentIndex = array.length,
    randomIndex;

  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
};

/**
 * Main function
 */
main();
